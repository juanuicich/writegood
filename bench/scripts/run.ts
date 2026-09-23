/** Run the passes of one rule set over the benchmark drafts, score them, and
 *  write one result file.
 *
 *  bun bench/scripts/run.ts --provider openrouter --model deepseek/deepseek-v4.1-flash \
 *    --thinking off --rules 2026-09-23-rewrite --pipeline hybrid --label v41-flash
 *
 *  --provider deepseek|openrouter      default deepseek
 *  --model ID                          deepseek: deepseek-flash, deepseek-v4-pro
 *                                      openrouter: vendor/model, as OpenRouter lists it
 *  --or-provider SLUG                  openrouter: the only upstream provider allowed.
 *                                      Default: the model's vendor (deepseek/… → deepseek)
 *  --thinking off|low|medium|high|max|default   default off
 *  --rules NAME                        a folder in bench/rules. Default 2026-09-23-rewrite
 *  --pipeline plain|fast|hybrid        default hybrid
 *      plain   every pass at --thinking; findings stored as returned
 *      fast    every pass at --thinking; code filters, then three verifiers vote
 *      hybrid  as the app runs: a pass whose rule file sets `thinking` uses it
 *              and is stored as returned; every other pass runs as in fast
 *  --scope native|document             document: every pass sends the whole draft once
 *  --drafts a.md,b.md                  names in bench/corpus. Default: the four scored drafts
 *  --limit N                           calls in flight per draft. Default 32, as the app
 *  --ceiling SECS                      per call, unless the rule file sets timeout_secs. Default 100
 *  --votes N --need K                  verifier votes and keeps needed. Default 3 and 2, as the app
 *  --label NAME                        required; the file is results/<date>-<label>.json
 *  --note TEXT                         a sentence stored with the result
 *  --dry                               print the plan and make no calls
 *  --force                             overwrite an existing result with the same name
 *
 *  Prompts, preamble, parser, filters and verifier are the app's own code. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { preamble } from "../../src/lib/passes/schema";
import { buildPrompt, paragraphs, readFindings } from "../../src/lib/passes/parse";
import { inParagraph, Repeats } from "../../src/lib/passes/filter";
import { buildVerifyPrompt, parseVerdicts, tally, VERIFY_SYSTEM } from "../../src/lib/passes/verify";
import { limiter } from "../../src/lib/passes/limit";
import { windowOf, windows } from "../../src/lib/passes/windows";
import type { NewFinding, Pass } from "../../src/lib/ipc";
import {
  deepseek, draftPath, firstParty, flag, loadRules, openrouter, quantiles, RESULTS, SCORED, words,
  type CallRecord, type DraftRecord, type Finding, type Provider, type Result, type Thinking,
} from "./lib";
import { describe, passesRun, score } from "./score";

const LEVELS = ["off", "low", "medium", "high", "max", "default"];
const providerName = flag("--provider", "deepseek")!;
const model = flag("--model", providerName === "deepseek" ? "deepseek-flash" : undefined);
const thinking = flag("--thinking", "off") as Thinking;
const rulesName = flag("--rules", "2026-09-23-rewrite")!;
const pipeline = flag("--pipeline", "hybrid") as Result["config"]["pipeline"];
const scope = flag("--scope", "native") as "native" | "document";
const limit = Number(flag("--limit", "32"));
const ceiling = Number(flag("--ceiling", "100"));
const votes = Number(flag("--votes", "3"));
const need = Number(flag("--need", "2"));
const label = flag("--label");
const note = flag("--note");
const drafts = (flag("--drafts") ?? SCORED.join(",")).split(",");
const date = new Date().toISOString().slice(0, 10);

if (!model) throw new Error("--model is required");
if (!label || !/^[\w.-]+$/.test(label)) throw new Error("--label is required: letters, digits, dot, dash, underscore");
if (!LEVELS.includes(thinking)) throw new Error(`--thinking is one of ${LEVELS.join(", ")}`);
if (!["plain", "fast", "hybrid"].includes(pipeline)) throw new Error("--pipeline is plain, fast or hybrid");
if (!["deepseek", "openrouter"].includes(providerName)) throw new Error("--provider is deepseek or openrouter");

const outFile = join(RESULTS, `${date}-${label}.json`);
if (existsSync(outFile) && !process.argv.includes("--force")) throw new Error(`${outFile} exists; pick another --label or pass --force`);

const passes = loadRules(rulesName);
const orProvider = providerName === "openrouter" ? flag("--or-provider") ?? firstParty(model) : null;

/** The thinking level of each pass, and whether it is verified. */
const levelOf = (p: Pass): Thinking => (pipeline === "hybrid" && p.thinking ? (p.thinking as Thinking) : thinking);
const verifiedOf = (p: Pass) => pipeline === "fast" || (pipeline === "hybrid" && levelOf(p) === "off");
const thinkingPasses = Object.fromEntries(passes.filter((p) => levelOf(p) !== thinking).map((p) => [p.slug, levelOf(p)]));

console.log(
  `${label}: ${providerName}${orProvider ? ` via ${orProvider}` : ""} ${model}, thinking ${thinking}, ` +
    `pipeline ${pipeline}, rules ${rulesName}, ${passes.length} passes, drafts ${drafts.join(", ")}`,
);
for (const p of passes) console.log(`  ${p.slug.padEnd(18)} ${p.scope.padEnd(9)} thinking ${levelOf(p)}${verifiedOf(p) ? ", verified" : ""}`);
if (process.argv.includes("--dry")) process.exit(0);

const provider: Provider = providerName === "deepseek" ? deepseek(model) : openrouter(model, orProvider!);

const rules = { allowSuggestions: false, redactSuggestions: true, forbidPraise: true, blindJudge: true };

interface Reply { draft: string; pass: string; stage: string; chunk: number | null; reply: string }

async function runDraft(name: string) {
  const draft = readFileSync(draftPath(name), "utf8");
  // A run id at the head of the system prompt keeps one run from reading
  // another run's prompt cache, so repeat runs measure the same thing.
  const system = `Run ${crypto.randomUUID()}.\n\n${preamble(rules)}`;
  const paras = paragraphs(draft);
  const wins = windows(paras, draft);
  const lim = limiter(limit);
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const calls: CallRecord[] = [];
  const replies: Reply[] = [];
  const findings: Finding[] = [];
  let candidates = 0;
  let quickDone = 0;

  const ask = async (pass: Pass, stage: "pass" | "verify", chunk: number | null, sys: string, prompt: string, priority: number) =>
    lim(async () => {
      const level = levelOf(pass);
      const rec: CallRecord = {
        draft: name, pass: pass.slug, stage, chunk, thinking: level, start: now(), secs: 0,
        input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0,
      };
      calls.push(rec);
      try {
        const { text, usage } = await provider.chat(sys, prompt, level, pass.timeoutSecs ?? ceiling);
        Object.assign(rec, usage);
        replies.push({ draft: name, pass: pass.slug, stage, chunk, reply: text });
        return { text, rec };
      } catch (e) {
        rec.error = e instanceof Error ? e.message : String(e);
        return null;
      } finally {
        rec.secs = now() - rec.start;
      }
    }, priority);

  const runPass = async (pass: Pass) => {
    const verified = verifiedOf(pass);
    const repeats = new Repeats(draft);
    const doc = scope === "document" || pass.scope === "document";
    const questions = doc
      ? [{ chunk: null as number | null, context: draft, excerpt: false }]
      : paras.map((_, i) => ({ chunk: i as number | null, context: windowOf(wins, i).text, excerpt: windowOf(wins, i).excerpt }));
    const pending = new Map<string, NewFinding[]>();
    const kept: NewFinding[][] = [];
    await Promise.all(questions.map(async (q) => {
      const answer = await ask(pass, "pass", q.chunk, system, buildPrompt(pass, q.context, q.chunk === null ? null : paras[q.chunk]!, q.excerpt), verified ? 1 : 0);
      if (answer === null) return;
      const { text, rec } = answer;
      let found: NewFinding[];
      try {
        found = readFindings(text, provider.name).found;
      } catch (e) {
        rec.unreadable = e instanceof Error ? e.message : String(e);
        return;
      }
      rec.candidates = found.length;
      candidates += found.length;
      if (!verified) return void kept.push(found);
      const left = repeats.take(q.chunk === null ? found : inParagraph(found, paras[q.chunk]!));
      if (left.length) pending.set(q.context, [...(pending.get(q.context) ?? []), ...left]);
    }));
    // Verify a window's candidates together, as the app does.
    await Promise.all([...pending].map(async ([context, cands]) => {
      const prompt = buildVerifyPrompt(pass.prompt, context, cands);
      const ballots = await Promise.all(Array.from({ length: votes }, async () => {
        const answer = await ask(pass, "verify", null, VERIFY_SYSTEM, prompt, 1);
        if (answer === null) return null;
        const v = parseVerdicts(answer.text, cands.length);
        if (v === null) answer.rec.unreadable = "the verifier's reply holds no verdicts";
        return v;
      }));
      const keep = tally(ballots, cands.length, need);
      kept.push(cands.filter((_, i) => keep[i]));
    }));
    for (const f of kept.flat()) findings.push({ draft: name, pass: pass.slug, quote: f.quote, severity: f.severity, note: f.note });
    if (levelOf(pass) === "off") quickDone = Math.max(quickDone, now());
  };

  // Passes that think queue first, as in the app.
  const ordered = [...passes].sort((a, b) => Number(levelOf(a) === "off") - Number(levelOf(b) === "off"));
  await Promise.all(ordered.map(runPass));
  const wall = now();

  const passCalls = calls.filter((c) => c.stage === "pass");
  const sum = (f: (c: CallRecord) => number) => calls.reduce((n, c) => n + f(c), 0);
  const record: DraftRecord = {
    draft: name,
    words: words(draft),
    paragraphs: paras.length,
    wall,
    firstFindings: passes.some((p) => levelOf(p) === "off") ? quickDone : null,
    calls: calls.length,
    input: sum((c) => c.input),
    cacheRead: sum((c) => c.cacheRead),
    output: sum((c) => c.output),
    reasoning: sum((c) => c.reasoning),
    cost: sum((c) => c.cost),
    verifyCost: calls.filter((c) => c.stage === "verify").reduce((n, c) => n + c.cost, 0),
    latency: quantiles(passCalls.map((c) => c.secs)),
    errors: calls.filter((c) => c.error).length,
    unreadable: calls.filter((c) => c.unreadable).length,
    candidates,
    kept: findings.length,
  };
  return { record, calls, findings, replies };
}

const runs = await Promise.all(drafts.map(runDraft));
const calls = runs.flatMap((r) => r.calls);
const findings = runs.flatMap((r) => r.findings);
const result: Result = {
  schema: 1,
  label,
  date,
  source: "bench/scripts/run.ts",
  config: {
    provider: providerName, orProvider, model, thinking, thinkingPasses, pipeline, rules: rulesName, scope,
    limit, votes: pipeline === "plain" ? null : votes, need: pipeline === "plain" ? null : need, ceilingSecs: ceiling, drafts,
    ...(note ? { note } : {}),
  },
  rules: rulesName,
  drafts: runs.map((r) => r.record),
  scores: null,
  findings,
  calls,
  errors: [...new Set(calls.flatMap((c) => [c.error, c.unreadable].filter(Boolean) as string[]))].map((e) => e.slice(0, 300)),
};
result.scores = score(findings, passesRun(result)).scores;

mkdirSync(join(RESULTS, "raw"), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 1));
writeFileSync(join(RESULTS, "raw", `${date}-${label}.replies.json.gz`), gzipSync(JSON.stringify(runs.flatMap((r) => r.replies))));

for (const d of result.drafts) {
  console.log(
    `  ${d.draft.padEnd(16)} wall ${d.wall.toFixed(1).padStart(6)}s  first ${d.firstFindings?.toFixed(1) ?? "-"}s  ${String(d.calls).padStart(4)} calls  ` +
      `p50 ${d.latency.p50.toFixed(1)}s p90 ${d.latency.p90.toFixed(1)}s  $${d.cost.toFixed(4)}  kept ${d.kept} of ${d.candidates}  ` +
      `errors ${d.errors}  unreadable ${d.unreadable}`,
  );
}
const served = [...new Set(calls.map((c) => c.servedBy).filter(Boolean))];
if (served.length) console.log(`  served by: ${served.join(", ")}`);
if (result.errors.length) console.log(`  first error: ${result.errors[0]}`);
if (result.scores) console.log(describe(label, result.scores, true));
console.log(`wrote ${outFile}`);
