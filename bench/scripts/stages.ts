/** Score a run at two stages: the pass candidates before the verifier, and
 *  the findings kept after it. The difference shows whether a model loses
 *  recall when it answers or when it verifies.
 *
 *  bun bench/scripts/stages.ts bench/results/2026-09-23-or-luna-none-fast-1.json [more…]
 *
 *  It reads the model replies from results/raw/<date>-<label>.replies.json.gz,
 *  applies the app's paragraph filter and repeat filter, and scores them. It
 *  also counts pass replies that hold an empty array. */
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { basename, join } from "node:path";
import { paragraphs, readFindings } from "../../src/lib/passes/parse";
import { inParagraph, Repeats } from "../../src/lib/passes/filter";
import { draftPath, RESULTS, type Finding, type Result } from "./lib";
import { passesRun, score } from "./score";

const pct = (n: number) => `${(100 * n).toFixed(1)}%`;

for (const file of process.argv.slice(2)) {
  const r: Result = JSON.parse(readFileSync(file, "utf8"));
  const raw = join(RESULTS, "raw", basename(file).replace(/\.json$/, ".replies.json.gz"));
  if (!existsSync(raw)) {
    console.log(`${r.label}: no replies file`);
    continue;
  }
  const replies: { draft: string; pass: string; stage: string; chunk: number | null; reply: string }[] =
    JSON.parse(gunzipSync(readFileSync(raw)).toString());
  const cands: Finding[] = [];
  let passReplies = 0;
  let empty = 0;
  const repeats = new Map<string, Repeats>();
  for (const x of replies) {
    if (x.stage !== "pass") continue;
    passReplies++;
    const draft = readFileSync(draftPath(x.draft), "utf8");
    let found;
    try {
      found = readFindings(x.reply).found;
    } catch {
      continue;
    }
    if (found.length === 0) empty++;
    const rkey = `${x.draft}#${x.pass}`;
    if (!repeats.has(rkey)) repeats.set(rkey, new Repeats(draft));
    const left = x.chunk === null ? found : repeats.get(rkey)!.take(inParagraph(found, paragraphs(draft)[x.chunk]!));
    for (const f of left) cands.push({ draft: x.draft, pass: x.pass, quote: f.quote, severity: f.severity, note: f.note });
  }
  const run = passesRun(r);
  const before = score(cands, run).scores;
  const after = score(r.findings, run).scores;
  if (!before || !after) {
    console.log(`${r.label}: ${passReplies} pass replies, ${empty} empty; no reference`);
    continue;
  }
  const b = before.overall;
  const a = after.overall;
  console.log(
    `${r.label}: ${passReplies} pass replies, ${empty} empty (${pct(empty / passReplies)})\n` +
      `  candidates  ${String(b.tp + b.fp).padStart(4)}  P ${pct(b.precision)}  R ${pct(b.recall)}  F1 ${pct(b.f1)}\n` +
      `  kept        ${String(a.tp + a.fp).padStart(4)}  P ${pct(a.precision)}  R ${pct(a.recall)}  F1 ${pct(a.f1)}`,
  );
}
