/** Score a bench2 run against reference findings.
 *
 *  Usage: bun score.ts run.json [--gold DIR] [--by-pass]
 *
 *  Reference: DIR/gold-<draft>.json, an array of {category, quote}.
 *  Decoys: DIR/key-<draft>.json items with kind "decoy" (optional).
 *  Drafts: DIR/<draft>, or ~/.writegood/documents/<draft>.
 *
 *  A prediction matches a reference item of the same pass when their spans
 *  overlap. topic-flow matches within one sentence; paragraph-order and length
 *  within one paragraph. Matching is one to one. A quote not in the draft is
 *  counted as unanchored and as a false positive. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const S = "<scratch>";
const file = process.argv[2]!;
const gi = process.argv.indexOf("--gold");
const GOLD = gi >= 0 ? process.argv[gi + 1]! : join(S, "eval");
const byPass = process.argv.includes("--by-pass");
const di = process.argv.indexOf("--dump");
const dump: { draft: string; category: string; quote: string; note: string }[] = [];

const run = JSON.parse(readFileSync(file, "utf8"));
const draftPath = (d: string) => [join(GOLD, d), join(homedir(), ".writegood/documents", d)].find(existsSync)!;
const stem = (d: string) => d.replace(/^draft-/, "").replace(/\.md$/, "");

type Span = { from: number; to: number };
/** Every occurrence of the quote, preferring those on word boundaries, so
 *  "very" does not land inside "every". */
function locateAll(text: string, quote: string): Span[] {
  const find = (q: string) => {
    const all: Span[] = [];
    for (let i = text.indexOf(q); i >= 0 && q.length > 0; i = text.indexOf(q, i + 1)) all.push({ from: i, to: i + q.length });
    const word = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
    const clean = all.filter((s) => !(word(text[s.from - 1]) && word(q[0])) && !(word(text[s.to]) && word(q.at(-1))));
    return clean.length ? clean : all;
  };
  const exact = find(quote);
  return exact.length ? exact : find(quote.replace(/\*+/g, "").trim());
}
function locate(text: string, quote: string): Span | null {
  let i = text.indexOf(quote);
  if (i < 0) {
    const bare = quote.replace(/\*+/g, "").trim();
    i = text.indexOf(bare);
    if (i >= 0) return { from: i, to: i + bare.length };
    return null;
  }
  return { from: i, to: i + quote.length };
}
function unit(text: string, at: number, kind: "sentence" | "paragraph"): Span {
  const para = { from: text.lastIndexOf("\n\n", at) + 1, to: (() => { const j = text.indexOf("\n\n", at); return j < 0 ? text.length : j; })() };
  if (kind === "paragraph") return para;
  let from = para.from;
  for (let i = at - 1; i >= para.from; i--) if (/[.!?]/.test(text[i]!) && /\s/.test(text[i + 1] ?? "")) { from = i + 1; break; }
  let to = para.to;
  for (let i = at; i < para.to; i++) if (/[.!?]/.test(text[i]!)) { to = i + 1; break; }
  return { from, to };
}
const widen = (text: string, s: Span, pass: string): Span =>
  pass === "topic-flow" ? unit(text, s.from, "sentence")
  : pass === "paragraph-order" || pass === "length" ? unit(text, s.from, "paragraph")
  : s;
const overlap = (a: Span, b: Span) => a.from < b.to && b.from < a.to;

const tally = new Map<string, { tp: number; fp: number; fn: number; unanchored: number; decoy: number }>();
const t = (p: string) => tally.get(p) ?? (tally.set(p, { tp: 0, fp: 0, fn: 0, unanchored: 0, decoy: 0 }), tally.get(p)!);

for (const r of run.results) {
  const goldFile = join(GOLD, `gold-${stem(r.draft)}.json`);
  if (!existsSync(goldFile)) continue;
  const text = readFileSync(draftPath(r.draft), "utf8");
  const gold: { category: string; quote: string }[] = JSON.parse(readFileSync(goldFile, "utf8"));
  const keyFile = join(GOLD, `key-${stem(r.draft)}.json`);
  const decoys: { category: string; quote: string }[] = existsSync(keyFile)
    ? JSON.parse(readFileSync(keyFile, "utf8")).filter((k: any) => k.kind === "decoy")
    : [];
  const passes = new Set<string>(r.calls.map((c: any) => c.pass));
  for (const pass of passes) {
    const g = gold.filter((x) => x.category === pass).map((x) => locateAll(text, x.quote).map((s) => widen(text, s, pass))).filter((o) => o.length);
    const used = new Set<number>();
    const preds = r.calls.filter((c: any) => c.pass === pass).flatMap((c: any) => c.findings);
    const d = decoys.filter((x) => x.category === pass).map((x) => locate(text, x.quote)).filter(Boolean) as Span[];
    for (const f of preds) {
      const occ = locateAll(text, f.quote);
      if (!occ.length) { t(pass).unanchored++; t(pass).fp++; continue; }
      const s = occ[0]!;
      const ws = occ.map((o) => widen(text, o, pass));
      const hit = g.findIndex((x, i) => !used.has(i) && x.some((gs) => ws.some((w) => overlap(gs, w))));
      if (hit >= 0) { used.add(hit); t(pass).tp++; }
      else {
        // A second finding on an already matched reference item is a duplicate,
        // not a new error; it counts as a false positive all the same.
        t(pass).fp++;
        dump.push({ draft: r.draft, category: pass, quote: f.quote, note: f.note });
        if (d.some((x) => overlap(x, s))) t(pass).decoy++;
      }
    }
    t(pass).fn += g.length - used.size;
  }
}

const f1 = (x: { tp: number; fp: number; fn: number }) => {
  const p = x.tp / Math.max(1, x.tp + x.fp);
  const r = x.tp / Math.max(1, x.tp + x.fn);
  return { p, r, f: p + r === 0 ? 0 : (2 * p * r) / (p + r) };
};
const all = [...tally.values()].reduce((a, x) => ({ tp: a.tp + x.tp, fp: a.fp + x.fp, fn: a.fn + x.fn, unanchored: a.unanchored + x.unanchored, decoy: a.decoy + x.decoy }), { tp: 0, fp: 0, fn: 0, unanchored: 0, decoy: 0 });
const o = f1(all);
const pct = (n: number) => (100 * n).toFixed(0).padStart(3) + "%";
console.log(`${run.label}\n  overall  P ${pct(o.p)}  R ${pct(o.r)}  F1 ${pct(o.f)}  tp ${all.tp} fp ${all.fp} fn ${all.fn}  unanchored ${all.unanchored}  decoy hits ${all.decoy}`);
if (byPass) {
  for (const [pass, x] of [...tally].sort()) {
    const s = f1(x);
    console.log(`  ${pass.padEnd(18)} P ${pct(s.p)}  R ${pct(s.r)}  F1 ${pct(s.f)}  tp ${x.tp} fp ${x.fp} fn ${x.fn}  unanch ${x.unanchored}  decoy ${x.decoy}`);
  }
}
if (di >= 0) (await import("node:fs")).writeFileSync(process.argv[di + 1]!, JSON.stringify(dump, null, 2));
