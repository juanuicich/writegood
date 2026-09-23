/** Run the three Jev-assisted passes — nominalization, passive-actor,
 *  filler-words — over the benchmark drafts, score them, and write one
 *  result file in the same shape bench/scripts/score.ts and table.ts read.
 *
 *  Code finds every candidate span in a paragraph (regex: weak verb near a
 *  nominalized noun; passive or impersonal verb with no stated actor; a
 *  filler word or stock phrase). Jev answers one Noul question per
 *  candidate — "is this a genuine instance, given the same exclusions the
 *  LLM rule lists?" — and the app never sees Jev's words: the quote is a
 *  verbatim span of the draft and the note is fixed text per rule.
 *
 *  bun bench/scripts/jev/run-jev.ts --label jev-v1 [--drafts a.md,b.md] [--budget 5]
 *
 *  Rule set: bench/rules/jev-2026-09-23/ (nominalization.md, passive-actor.md,
 *  filler-words.md) documents the same instructions and criteria this file
 *  sends. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paragraphs } from "../../../src/lib/passes/parse";
import { limiter } from "../../../src/lib/passes/limit";
import { draftPath, flag, quantiles, RESULTS, SCORED, words, type CallRecord, type DraftRecord, type Finding } from "../lib";
import { describe, passesRun, score } from "../score";
import {
  findFillerCandidates, findNominalizationCandidates, findPassiveActorCandidates, type Candidate,
} from "./candidates";
import { askJev, checkBudget, totalCalls, totalCost, type NoulQuestion } from "./jev-client";
import { fillerWordQuestion, KEEP_THRESHOLD, nominalizationQuestion, passiveActorQuestion, severityFromProbability } from "./rules";

const RULES_NAME = "jev-2026-09-23";
const label = flag("--label", `jev-${new Date().toISOString().slice(0, 10)}`)!;
const draftsFlag = flag("--drafts");
const drafts = (draftsFlag ?? SCORED.join(",")).split(",");
const budget = Number(flag("--budget", "5"));
const ceiling = Number(flag("--ceiling", "60"));
const date = new Date().toISOString().slice(0, 10);
const outFile = join(RESULTS, `${date}-${label}.json`);
if (existsSync(outFile) && !process.argv.includes("--force")) throw new Error(`${outFile} exists; pick another --label or pass --force`);

type PassName = "nominalization" | "passive-actor" | "filler-words";
const PASSES: { slug: PassName; find: (p: string) => Candidate[]; question: (c: Candidate) => NoulQuestion }[] = [
  { slug: "nominalization", find: findNominalizationCandidates, question: nominalizationQuestion },
  { slug: "passive-actor", find: findPassiveActorCandidates, question: passiveActorQuestion },
  { slug: "filler-words", find: findFillerCandidates, question: fillerWordQuestion },
];

const NOTE: Record<PassName, (c: Candidate) => string> = {
  nominalization: (c) => `Weak verb "${c.meta.verb}" carries the buried noun "${c.meta.noun}."`,
  "passive-actor": () => "Passive or impersonal construction with no actor named nearby.",
  "filler-words": (c) =>
    c.meta.kind === "stock"
      ? "Stock phrase that delays the content and adds nothing."
      : c.meta.kind === "hedge"
        ? "Empty hedge or claim of obviousness that adds no fact."
        : "Intensifier that adds emphasis only.",
};

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
      PASSES.map(async ({ slug, find, question }) => {
        const cands = find(para);
        if (!cands.length) return;
        candidates += cands.length;
        const questions: Record<string, NoulQuestion> = {};
        cands.forEach((c, i) => (questions[`q${i}`] = question(c)));
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
            rec.candidates = cands.length;
            cands.forEach((c, i) => {
              const p = answers[`q${i}`]?.noul;
              if (p === undefined || p < KEEP_THRESHOLD[slug]) return;
              findings.push({ draft: name, pass: slug, quote: c.quote, severity: severityFromProbability(p), note: NOTE[slug](c) });
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
  source: "bench/scripts/jev/run-jev.ts",
  config: {
    provider: "jev",
    orProvider: null,
    model: "jev-latest",
    thinking: "default" as const,
    thinkingPasses: {},
    pipeline: "plain" as const,
    rules: RULES_NAME,
    scope: "native" as const,
    limit: 8,
    votes: null,
    need: null,
    ceilingSecs: ceiling,
    drafts,
    note: "Candidates from code (regex); Jev answers one Noul question per candidate. See bench/rules/jev-2026-09-23/.",
  },
  rules: RULES_NAME,
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
