/** Run sentence-openings and the code-only filler-words variant with no
 *  model at all — regex and word counts, nothing else — score them, and
 *  write one result file in the shape score.ts and table.ts read.
 *
 *  Task 4 of the Jev benchmark asks for this: both passes may not need a
 *  model, so run them as plain code and compare.
 *
 *  bun bench/scripts/jev/run-code.ts --label code-v1 [--drafts a.md,b.md]
 *
 *  Rule set: bench/rules/jev-2026-09-23/sentence-openings-code.md and
 *  filler-words-code.md document the same logic this file runs. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paragraphs } from "../../../src/lib/passes/parse";
import { draftPath, flag, quantiles, RESULTS, SCORED, words, type CallRecord, type DraftRecord, type Finding } from "../lib";
import { describe, passesRun, score } from "../score";
import { findFillerWordsCode, findSentenceOpenings } from "./candidates";

const RULES_NAME = "jev-2026-09-23";
const label = flag("--label", `code-${new Date().toISOString().slice(0, 10)}`)!;
const drafts = (flag("--drafts") ?? SCORED.join(",")).split(",");
const date = new Date().toISOString().slice(0, 10);
const outFile = join(RESULTS, `${date}-${label}.json`);
if (existsSync(outFile) && !process.argv.includes("--force")) throw new Error(`${outFile} exists; pick another --label or pass --force`);

const PASSES: { slug: "sentence-openings" | "filler-words"; find: (p: string) => ReturnType<typeof findSentenceOpenings> }[] = [
  { slug: "sentence-openings", find: findSentenceOpenings },
  { slug: "filler-words", find: findFillerWordsCode },
];

function runDraft(name: string) {
  const draft = readFileSync(draftPath(name), "utf8");
  const paras = paragraphs(draft);
  const t0 = performance.now();
  const calls: CallRecord[] = [];
  const findings: Finding[] = [];
  let candidates = 0;

  for (const { slug, find } of PASSES) {
    for (const [chunk, para] of paras.entries()) {
      const cstart = performance.now();
      const found = find(para);
      const secs = (performance.now() - cstart) / 1000;
      candidates += found.length;
      calls.push({
        draft: name, pass: slug, stage: "pass", chunk, thinking: "default", start: (cstart - t0) / 1000, secs,
        input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0, costSource: "rates", servedBy: "code",
        candidates: found.length,
      });
      for (const f of found) findings.push({ draft: name, pass: slug, quote: f.quote, severity: f.severity, note: f.note });
    }
  }

  const wall = (performance.now() - t0) / 1000;
  const record: DraftRecord = {
    draft: name,
    words: words(draft),
    paragraphs: paras.length,
    wall,
    firstFindings: wall,
    calls: calls.length,
    input: 0,
    cacheRead: 0,
    output: 0,
    reasoning: 0,
    cost: 0,
    verifyCost: 0,
    latency: quantiles(calls.map((c) => c.secs)),
    errors: 0,
    unreadable: 0,
    candidates,
    kept: findings.length,
  };
  return { record, calls, findings };
}

const runs = drafts.map(runDraft);
const calls = runs.flatMap((r) => r.calls);
const findings = runs.flatMap((r) => r.findings);
const result = {
  schema: 1 as const,
  label,
  date,
  source: "bench/scripts/jev/run-code.ts",
  config: {
    provider: "code",
    orProvider: null,
    model: "none",
    thinking: "default" as const,
    thinkingPasses: {},
    pipeline: "plain" as const,
    rules: RULES_NAME,
    scope: "native" as const,
    limit: 1,
    votes: null,
    need: null,
    ceilingSecs: 0,
    drafts,
    note: "No model. Regex candidates become findings directly, with a deterministic severity per rule.",
  },
  rules: RULES_NAME,
  drafts: runs.map((r) => r.record),
  scores: null as any,
  findings,
  calls,
  errors: [],
};
result.scores = score(findings, passesRun(result as any)).scores;

mkdirSync(RESULTS, { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 1));

for (const d of result.drafts) {
  console.log(`  ${d.draft.padEnd(16)} wall ${(d.wall * 1000).toFixed(2)}ms  kept ${d.kept} of ${d.candidates}`);
}
if (result.scores) console.log(describe(label, result.scores, true));
console.log(`wrote ${outFile}`);
