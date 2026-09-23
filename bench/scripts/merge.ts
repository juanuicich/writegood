/** Compose one result from two runs: every pass of a base run, with some
 *  passes taken from a second run instead. This measures a hybrid that uses
 *  one model for the fast passes and another for paragraph order.
 *
 *  bun bench/scripts/merge.ts --label H-ds-gemlow-1 \
 *    --base bench/results/2026-09-23-or-dsflash-fast-1.json \
 *    --take bench/results/2026-09-23-or-po-gemini-low-1.json [--passes paragraph-order]
 *
 *  --passes   the passes to take from --take. Default: every pass it ran.
 *             The base run's calls and findings for those passes are dropped.
 *  --force    overwrite an existing result with the same name
 *
 *  Per draft, wall is the slower of the two parts, because the app runs them
 *  at the same time. First findings is the base run's. Cost, calls and
 *  tokens start from the base run's totals, less its calls for the taken
 *  passes, plus the second run's calls for them. A converted result records
 *  verifier cost per draft only, so that part of the base run stays whole.
 *  Latency quantiles are over the pass calls of both parts.
 *  Both runs must use the same rule set and the same drafts. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { flag, quantiles, RESULTS, type CallRecord, type DraftRecord, type Result } from "./lib";
import { describe, passesRun, score } from "./score";

const label = flag("--label");
const baseFile = flag("--base");
const takeFile = flag("--take");
if (!label || !/^[\w.-]+$/.test(label)) throw new Error("--label is required: letters, digits, dot, dash, underscore");
if (!baseFile || !takeFile) throw new Error("--base and --take are required");

const base: Result = JSON.parse(readFileSync(baseFile, "utf8"));
const take: Result = JSON.parse(readFileSync(takeFile, "utf8"));
if (base.rules !== take.rules) throw new Error(`rule sets differ: ${base.rules} and ${take.rules}`);
const drafts = base.drafts.map((d) => d.draft);
if (drafts.join() !== take.drafts.map((d) => d.draft).join()) throw new Error("the two runs have different drafts");

const taken = new Set(flag("--passes")?.split(",") ?? take.calls.filter((c) => c.stage === "pass").map((c) => c.pass));
const fromBase = <T extends { pass: string }>(xs: T[]) => xs.filter((x) => !taken.has(x.pass));
const fromTake = <T extends { pass: string }>(xs: T[]) => xs.filter((x) => taken.has(x.pass));
const calls = [...fromBase(base.calls), ...fromTake(take.calls)];
const findings = [...fromBase(base.findings), ...fromTake(take.findings)];

const date = new Date().toISOString().slice(0, 10);
const outFile = join(RESULTS, `${date}-${label}.json`);
if (existsSync(outFile) && !process.argv.includes("--force")) throw new Error(`${outFile} exists; pick another --label or pass --force`);

const draftRecords: DraftRecord[] = drafts.map((name) => {
  const b = base.drafts.find((d) => d.draft === name)!;
  const t = take.drafts.find((d) => d.draft === name)!;
  const mine = calls.filter((c) => c.draft === name);
  const dropped = base.calls.filter((c) => c.draft === name && taken.has(c.pass));
  const added = take.calls.filter((c) => c.draft === name && taken.has(c.pass));
  const swap = (total: number, f: (c: CallRecord) => number) =>
    total - dropped.reduce((n, c) => n + f(c), 0) + added.reduce((n, c) => n + f(c), 0);
  const verify = (c: CallRecord) => (c.stage === "verify" ? c.cost : 0);
  return {
    draft: name,
    words: b.words,
    paragraphs: b.paragraphs,
    wall: Math.max(b.wall, t.wall),
    firstFindings: b.firstFindings,
    calls: swap(b.calls, () => 1),
    input: swap(b.input, (c) => c.input),
    cacheRead: swap(b.cacheRead, (c) => c.cacheRead),
    output: swap(b.output, (c) => c.output),
    reasoning: swap(b.reasoning, (c) => c.reasoning),
    cost: swap(b.cost, (c) => c.cost),
    verifyCost: swap(b.verifyCost, verify),
    latency: quantiles(mine.filter((c) => c.stage === "pass").map((c) => c.secs)),
    errors: mine.filter((c) => c.error).length,
    unreadable: mine.filter((c) => c.unreadable).length,
    candidates: mine.reduce((n, c) => n + (c.candidates ?? 0), 0),
    kept: findings.filter((f) => f.draft === name).length,
  };
});

const passLevel = take.config.thinkingPasses?.[[...taken][0]!] ?? take.config.thinking;
const result: Result = {
  schema: 1,
  label,
  date,
  source: `bench/scripts/merge.ts: ${basename(baseFile)}, with ${[...taken].join(", ")} from ${basename(takeFile)}`,
  config: {
    ...base.config,
    orProvider: [base.config.orProvider, take.config.orProvider].filter(Boolean).join(" + ") || null,
    model: `${base.config.model} + ${take.config.model}`,
    thinkingPasses: { ...base.config.thinkingPasses, ...Object.fromEntries([...taken].map((p) => [p, passLevel])) },
    pipeline: "hybrid",
    note: `Composed: ${base.label} for the other passes; ${[...taken].join(", ")} from ${take.label} (${take.config.model}, thinking ${passLevel}).`,
  },
  rules: base.rules,
  drafts: draftRecords,
  scores: null,
  findings,
  calls,
  errors: [...new Set([...base.errors, ...take.errors])],
};
result.scores = score(findings, passesRun(result)).scores;
writeFileSync(outFile, JSON.stringify(result, null, 1));
if (result.scores) console.log(describe(label, result.scores, false));
console.log(`wrote ${outFile}`);
