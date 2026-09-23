/** Convert the runs made before this folder existed into result files.
 *
 *  Reads results/raw/scratch-runs/<name>.json.gz, written by the scratch
 *  harness in results/raw/scratch-scripts/, and writes
 *  results/2026-09-23-<name>.json with scores from score.ts.
 *
 *  Differences from run.ts:
 *  - Verifier calls were not recorded one by one. Each draft keeps their
 *    total cost and wall time only.
 *  - Code filters and the verifier were the scratch versions. The app's
 *    filter.ts and verify.ts copy them; the verifier prompt is the one the
 *    scratch harness called "balanced".
 *  - The R runs are composed: the fast passes of one run, and paragraph
 *    order from a run with thinking on. Their wall is the slower part.
 *
 *  Usage: bun bench/scripts/convert.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { paragraphs } from "../../src/lib/passes/parse";
import {
  draftPath, quantiles, RESULTS, words,
  type CallRecord, type DraftRecord, type Finding, type Result, type Thinking,
} from "./lib";
import { passesRun, score } from "./score";

const RAW = join(RESULTS, "raw", "scratch-runs");
const DATE = "2026-09-23";

interface Spec {
  name: string;
  model: string;
  thinking: Thinking;
  pipeline: Result["config"]["pipeline"];
  rules: string;
  scope?: "native" | "document";
  ceiling?: number;
  /** Passes that ran at their own thinking level. */
  thinkingPasses?: Record<string, Thinking>;
  note?: string;
}

const DOCFLOW = "2026-09-23-rewrite-docflow";
const REWRITE = "2026-09-23-rewrite";
const B_NOTE = "The app's setting before the fast passes: Flash with thinking on for every pass.";
const SPECS: Spec[] = [
  { name: "A-pro-high-300", model: "deepseek-v4-pro", thinking: "high", pipeline: "plain", rules: DOCFLOW, ceiling: 300 },
  { name: "B-flash-high", model: "deepseek-flash", thinking: "high", pipeline: "plain", rules: DOCFLOW, note: B_NOTE },
  { name: "B-flash-high-2", model: "deepseek-flash", thinking: "high", pipeline: "plain", rules: DOCFLOW, note: B_NOTE },
  { name: "B-flash-high-3", model: "deepseek-flash", thinking: "high", pipeline: "plain", rules: DOCFLOW, note: B_NOTE },
  { name: "B-flash-high-4", model: "deepseek-flash", thinking: "high", pipeline: "plain", rules: DOCFLOW, note: B_NOTE },
  { name: "C-flash-off", model: "deepseek-flash", thinking: "off", pipeline: "plain", rules: DOCFLOW },
  { name: "D-pro-off", model: "deepseek-v4-pro", thinking: "off", pipeline: "plain", rules: DOCFLOW },
  { name: "F-flash-off-doc", model: "deepseek-flash", thinking: "off", pipeline: "plain", rules: DOCFLOW, scope: "document" },
  { name: "G-pro-off-doc", model: "deepseek-v4-pro", thinking: "off", pipeline: "plain", rules: DOCFLOW, scope: "document" },
  { name: "P-fast-1", model: "deepseek-flash", thinking: "off", pipeline: "fast", rules: DOCFLOW },
  { name: "P-fast-2", model: "deepseek-flash", thinking: "off", pipeline: "fast", rules: DOCFLOW },
  { name: "P-fast-3", model: "deepseek-flash", thinking: "off", pipeline: "fast", rules: DOCFLOW },
  { name: "X3-tf-para-1", model: "deepseek-flash", thinking: "off", pipeline: "fast", rules: REWRITE },
  { name: "X3-tf-para-2", model: "deepseek-flash", thinking: "off", pipeline: "fast", rules: REWRITE },
  {
    name: "R-1", model: "deepseek-flash", thinking: "off", pipeline: "hybrid", rules: REWRITE,
    thinkingPasses: { "paragraph-order": "high" },
    note: "Composed: X3-tf-para-1 for eight passes, and paragraph order from X4-docthink-1 (Flash, thinking high). The configuration the app ships.",
  },
  {
    name: "R-2", model: "deepseek-flash", thinking: "off", pipeline: "hybrid", rules: REWRITE,
    thinkingPasses: { "paragraph-order": "high" },
    note: "Composed: X3-tf-para-2 for eight passes, and paragraph order from X4-docthink-2 (Flash, thinking high). The configuration the app ships.",
  },
];

const DOC_PASSES = new Set(["paragraph-order", "length"]);
/** A scratch error is a network failure or an unreadable reply. */
const network = (e: string) => /did not answer|^Error: \d{3} |fetch|socket|ECONN|timed out/i.test(e);

for (const spec of SPECS) {
  const run = JSON.parse(gunzipSync(readFileSync(join(RAW, `${spec.name}.json.gz`))).toString("utf8"));
  const levelOf = (pass: string): Thinking => spec.thinkingPasses?.[pass] ?? spec.thinking;
  const calls: CallRecord[] = [];
  const findings: Finding[] = [];
  const drafts: DraftRecord[] = [];
  for (const r of run.results) {
    const text = readFileSync(draftPath(r.draft), "utf8");
    const mine: CallRecord[] = [];
    let candidates = 0;
    for (const c of r.calls) {
      const doc = spec.scope === "document" || DOC_PASSES.has(c.pass) || (spec.rules === DOCFLOW && c.pass === "topic-flow");
      const rec: CallRecord = {
        draft: r.draft, pass: c.pass, stage: "pass", chunk: doc ? null : c.chunk, thinking: levelOf(c.pass),
        start: c.start, secs: c.secs, input: c.input, cacheRead: c.cacheRead, output: c.output,
        reasoning: c.reasoning ?? 0, cost: c.cost, costSource: "rates", servedBy: "deepseek",
      };
      if (c.error) {
        if (network(c.error)) rec.error = c.error;
        else rec.unreadable = c.error;
      }
      if (c.reply !== undefined && !c.error) {
        // Candidates before filters, where the reply is kept.
        const n = (c.reply.match(/"quote"\s*:/g) ?? []).length;
        rec.candidates = n;
        candidates += n;
      }
      mine.push(rec);
      for (const f of c.findings) findings.push({ draft: r.draft, pass: c.pass, quote: f.quote, severity: f.severity, note: f.note });
    }
    calls.push(...mine);
    const sum = (f: (c: CallRecord) => number) => mine.reduce((n, c) => n + f(c), 0);
    const verifyCost = r.verifyCost ?? 0;
    const quick = spec.pipeline === "hybrid" ? r.fastWall : spec.thinking === "off" ? r.wall : null;
    drafts.push({
      draft: r.draft,
      words: words(text),
      paragraphs: paragraphs(text).length,
      wall: r.wall,
      firstFindings: quick,
      calls: mine.length,
      input: sum((c) => c.input),
      cacheRead: sum((c) => c.cacheRead),
      output: sum((c) => c.output),
      reasoning: sum((c) => c.reasoning),
      cost: sum((c) => c.cost) + verifyCost,
      verifyCost,
      latency: quantiles(mine.map((c) => c.secs)),
      errors: mine.filter((c) => c.error).length,
      unreadable: mine.filter((c) => c.unreadable).length,
      candidates,
      kept: findings.filter((f) => f.draft === r.draft).length,
    });
  }
  const result: Result = {
    schema: 1,
    label: spec.name,
    date: DATE,
    source: `converted from results/raw/scratch-runs/${spec.name}.json.gz (scratch label: ${run.label})`,
    config: {
      provider: "deepseek", orProvider: null, model: spec.model, thinking: spec.thinking,
      thinkingPasses: spec.thinkingPasses ?? {}, pipeline: spec.pipeline, rules: spec.rules,
      scope: spec.scope ?? "native", limit: run.limit,
      votes: spec.pipeline === "plain" ? null : 3, need: spec.pipeline === "plain" ? null : 2,
      ceilingSecs: spec.ceiling ?? 100, drafts: run.results.map((r: any) => r.draft),
      ...(spec.note ? { note: spec.note } : {}),
    },
    rules: spec.rules,
    drafts,
    scores: null,
    findings,
    calls,
    errors: [...new Set(calls.flatMap((c) => [c.error, c.unreadable].filter(Boolean) as string[]))].map((e) => e.slice(0, 300)),
  };
  result.scores = score(findings, passesRun(result)).scores;
  writeFileSync(join(RESULTS, `${DATE}-${spec.name}.json`), JSON.stringify(result, null, 1));
  const o = result.scores!.overall;
  console.log(`${spec.name.padEnd(16)} F1 ${(100 * o.f1).toFixed(1)}%  P ${(100 * o.precision).toFixed(1)}%  R ${(100 * o.recall).toFixed(1)}%`);
}
