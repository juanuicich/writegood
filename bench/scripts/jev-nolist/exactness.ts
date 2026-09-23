/** How close each finding's quote is to the reference quote it overlaps.
 *
 *  The scorer counts any overlap as a hit, so a whole-sentence quote scores
 *  the same as the exact words. This script sorts each finding of the named
 *  passes into one class, against the reference item of the same pass that
 *  it overlaps most:
 *
 *    exact    the same text, ignoring case and surrounding space
 *    close    contains the reference quote, with at most N more words
 *    longer   contains the reference quote, with more than N more words
 *    partial  overlaps the reference quote but does not contain it
 *    none     overlaps no reference item
 *
 *  Words are counted with Intl.Segmenter. This is evaluation code; it
 *  decides nothing about what a pass flags.
 *
 *  bun bench/scripts/jev-nolist/exactness.ts --passes filler-words,passive-actor \
 *    [--extra 3] bench/results/2026-09-23-jev-choice-fw-1.json [more…]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS, draftPath, flag, stem, type Result } from "../lib";

const passes = (flag("--passes") ?? "filler-words,passive-actor").split(",");
const extra = Number(flag("--extra", "3"));
const files = process.argv.slice(2).filter((a, i, all) => a.endsWith(".json") && !["--passes", "--extra"].includes(all[i - 1]!));

const seg = new Intl.Segmenter(undefined, { granularity: "word" });
const count = (t: string) => [...seg.segment(t)].filter((s) => s.isWordLike).length;

type Span = { from: number; to: number };
function occurrences(text: string, q: string): Span[] {
  const out: Span[] = [];
  for (let i = text.indexOf(q); i >= 0 && q.length; i = text.indexOf(q, i + 1)) out.push({ from: i, to: i + q.length });
  return out;
}

for (const file of files) {
  const r: Result = JSON.parse(readFileSync(file, "utf8"));
  const tally = { exact: 0, close: 0, longer: 0, partial: 0, none: 0 };
  let total = 0;
  const words: number[] = [];
  for (const draft of [...new Set(r.findings.map((f) => f.draft))]) {
    const goldFile = join(CORPUS, `gold-${stem(draft)}.json`);
    if (!existsSync(goldFile)) continue;
    const text = readFileSync(draftPath(draft), "utf8");
    const gold: { category: string; quote: string }[] = JSON.parse(readFileSync(goldFile, "utf8"));
    for (const f of r.findings.filter((f) => f.draft === draft && passes.includes(f.pass))) {
      total++;
      words.push(count(f.quote));
      const occ = occurrences(text, f.quote);
      let best: { g: string; overlap: number } | null = null;
      for (const g of gold.filter((g) => g.category === f.pass)) {
        for (const gs of occurrences(text, g.quote)) {
          for (const fs of occ) {
            const ov = Math.min(gs.to, fs.to) - Math.max(gs.from, fs.from);
            if (ov > 0 && (!best || ov > best.overlap)) best = { g: g.quote, overlap: ov };
          }
        }
      }
      if (!best) { tally.none++; continue; }
      const a = f.quote.trim().toLowerCase();
      const b = best.g.trim().toLowerCase();
      if (a === b) tally.exact++;
      else if (a.includes(b)) tally[count(f.quote) - count(best.g) <= extra ? "close" : "longer"]++;
      else tally.partial++;
    }
  }
  words.sort((x, y) => x - y);
  const median = words.length ? words[Math.floor(words.length / 2)] : 0;
  console.log(
    `${r.label.padEnd(22)} findings ${String(total).padStart(3)}  exact ${tally.exact}  close(<=${extra}) ${tally.close}  ` +
      `longer ${tally.longer}  partial ${tally.partial}  none ${tally.none}  median quote ${median} words`,
  );
}
