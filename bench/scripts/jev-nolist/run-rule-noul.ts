/** Method 1: "rule as the whole criterion." For a pass whose problem shows
 *  up inside one sentence, ask Jev one Noul question per sentence, with the
 *  pass's own rule prompt — the exact text the LLM reads — as the
 *  instructions. No word list, no suffix pattern, no per-language marker:
 *  code only splits the paragraph into sentences (Intl.Segmenter) and hands
 *  each one to Jev with the rule attached.
 *
 *  The quote is the whole sentence. Coarser than the LLM's usual
 *  word-or-phrase span, but bench/scripts/score.ts matches on overlap, not
 *  exact text, so a sentence-wide quote still scores a real hit — at some
 *  cost to precision when a paragraph's gold item is narrower than the
 *  sentence, or when two gold items share a sentence (only one can match a
 *  single finding).
 *
 *  bun bench/scripts/jev-nolist/run-rule-noul.ts --label rulenoul-v1 \
 *    --passes nominalization,passive-actor,filler-words [--drafts a.md,b.md]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paragraphs } from "../../../src/lib/passes/parse";
import { limiter } from "../../../src/lib/passes/limit";
import { draftPath, flag, quantiles, RESULTS, SCORED, words, type CallRecord, type DraftRecord, type Finding } from "../lib";
import { describe, passesRun, score } from "../score";
import { sentencesOf } from "./segment";
import { ruleText } from "./rule-text";
import { askJev, checkBudget, totalCalls, totalCost, type NoulQuestion } from "./jev-client";

const label = flag("--label", `rulenoul-${new Date().toISOString().slice(0, 10)}`)!;
const drafts = (flag("--drafts") ?? SCORED.join(",")).split(",");
const passSlugs = (flag("--passes") ?? "nominalization,passive-actor,filler-words").split(",");
const budget = Number(flag("--budget", "5"));
const ceiling = Number(flag("--ceiling", "60"));
const keepThreshold = Number(flag("--keep", "0.5"));
const date = new Date().toISOString().slice(0, 10);
const outFile = join(RESULTS, `${date}-${label}.json`);
if (existsSync(outFile) && !process.argv.includes("--force")) throw new Error(`${outFile} exists; pick another --label or pass --force`);

function severity(p: number): "low" | "medium" | "high" {
  if (p >= 0.85) return "high";
  if (p >= 0.65) return "medium";
  return "low";
}

function question(rule: string, paragraph: string, sentence: string): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      rule,
      paragraph,
      sentence,
      question:
        "`rule` defines a specific problem an editor looks for in a piece of writing, written for a human editor to apply. " +
        "Read `sentence`, using `paragraph` only for surrounding context. Does `sentence` itself show that problem, per " +
        "`rule`? Answer yes only when `sentence`, not merely the paragraph around it, does what `rule` says to flag, and " +
        "apply every exclusion `rule` itself lists.",
    },
    criteria: {
      true: "`sentence` itself does what `rule` says to flag.",
      false: "`sentence` does not — including every case `rule`'s own exclusions name.",
    },
  };
}

const lim = limiter(8);

async function runDraft(name: string) {
  const draft = readFileSync(draftPath(name), "utf8");
  const paras = paragraphs(draft);
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const calls: CallRecord[] = [];
  const findings: Finding[] = [];
  let candidates = 0;

  await Promise.all(
    paras.flatMap((para, chunk) =>
      passSlugs.map(async (slug) => {
        const rule = ruleText(slug);
        const sentences = sentencesOf(para);
        if (!sentences.length) return;
        candidates += sentences.length;
        const questions: Record<string, NoulQuestion> = {};
        sentences.forEach((s, i) => (questions[`q${i}`] = question(rule, para, s.text)));
        checkBudget(budget);
        const rec: CallRecord = {
          draft: name, pass: slug, stage: "pass", chunk, thinking: "default", start: now(), secs: 0,
          input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0, costSource: "reported", servedBy: "jev",
        };
        calls.push(rec);
        await lim(async () => {
          try {
            const { answers, usage, secs } = await askJev(para, questions, ceiling);
            rec.secs = secs;
            rec.input = usage.inputTokens;
            rec.output = usage.outputTokens;
            rec.cost = usage.cost;
            rec.candidates = sentences.length;
            sentences.forEach((s, i) => {
              const p = answers[`q${i}`]?.noul;
              if (p === undefined || p < keepThreshold) return;
              findings.push({
                draft: name, pass: slug, quote: s.text, severity: severity(p),
                note: `Matches the pass rule "${slug}" (Jev, sentence-level, no candidate list).`,
              });
            });
          } catch (e) {
            rec.error = e instanceof Error ? e.message : String(e);
            rec.secs = now() - rec.start;
          }
        });
      }),
    ),
  );

  const wall = now();
  const record: DraftRecord = {
    draft: name,
    words: words(draft),
    paragraphs: paras.length,
    wall,
    firstFindings: wall,
    calls: calls.length,
    input: calls.reduce((n, c) => n + c.input, 0),
    cacheRead: 0,
    output: calls.reduce((n, c) => n + c.output, 0),
    reasoning: 0,
    cost: calls.reduce((n, c) => n + c.cost, 0),
    verifyCost: 0,
    latency: quantiles(calls.map((c) => c.secs)),
    errors: calls.filter((c) => c.error).length,
    unreadable: 0,
    candidates,
    kept: findings.length,
  };
  return { record, calls, findings };
}

const runs = await Promise.all(drafts.map(runDraft));
const calls = runs.flatMap((r) => r.calls);
const findings = runs.flatMap((r) => r.findings);
const result = {
  schema: 1 as const,
  label,
  date,
  source: "bench/scripts/jev-nolist/run-rule-noul.ts",
  config: {
    provider: "jev",
    orProvider: null,
    model: "jev-latest",
    thinking: "default" as const,
    thinkingPasses: {},
    pipeline: "plain" as const,
    rules: "2026-09-23-rewrite (verbatim, sentence-scope)",
    scope: "native" as const,
    limit: 8,
    votes: null,
    need: null,
    ceilingSecs: ceiling,
    drafts,
    note: `Method 1 (rule-as-criterion): one Noul per sentence, the pass's own rule text as instructions. Passes: ${passSlugs.join(", ")}. Keep >= ${keepThreshold}.`,
  },
  rules: "jev-nolist-method1",
  drafts: runs.map((r) => r.record),
  scores: null as any,
  findings,
  calls,
  errors: [...new Set(calls.flatMap((c) => (c.error ? [c.error] : [])))].map((e) => e.slice(0, 300)),
};
result.scores = score(findings, passesRun(result as any)).scores;

mkdirSync(RESULTS, { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 1));

for (const d of result.drafts) {
  console.log(
    `  ${d.draft.padEnd(16)} wall ${d.wall.toFixed(1).padStart(6)}s  ${String(d.calls).padStart(3)} calls  ` +
      `$${d.cost.toFixed(5)}  kept ${d.kept} of ${d.candidates}  errors ${d.errors}`,
  );
}
if (result.scores) console.log(describe(label, result.scores, true));
console.log(`Jev spend this run: $${totalCost.toFixed(5)} over ${totalCalls} requests`);
console.log(`wrote ${outFile}`);
