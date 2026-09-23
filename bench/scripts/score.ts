/** Score findings against the reference.
 *
 *  Reference: corpus/gold-<draft>.json, an array of {category, quote}.
 *  Decoys: corpus/key-<draft>.json items with kind "decoy", where present.
 *
 *  A finding matches a reference item of the same pass when their spans
 *  overlap. topic-flow matches within one sentence; paragraph-order and
 *  length within one paragraph. Matching is one to one, in the order the
 *  findings arrive. A second finding on a matched item is a false positive.
 *  A quote that is not in the draft counts as unanchored and as a false
 *  positive. A draft with no reference file is not scored.
 *
 *  As a command: bun bench/scripts/score.ts <result.json> [--by-pass]
 *  [--skip a,b] [--dump unmatched.json]. It prints the scores and, with
 *  --dump, writes the unmatched findings for a judge. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paragraphs } from "../../src/lib/passes/parse";
import { CORPUS, draftPath, stem, type Finding, type Result, type Tally } from "./lib";
import type { JoinMap } from "./join";

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
  if (i >= 0) return { from: i, to: i + quote.length };
  const bare = quote.replace(/\*+/g, "").trim();
  i = text.indexOf(bare);
  return i >= 0 ? { from: i, to: i + bare.length } : null;
}

function unit(text: string, at: number, kind: "sentence" | "paragraph"): Span {
  const end = text.indexOf("\n\n", at);
  const para = { from: text.lastIndexOf("\n\n", at) + 1, to: end < 0 ? text.length : end };
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

type Raw = { tp: number; fp: number; fn: number; unanchored: number; decoy: number };
const zero = (): Raw => ({ tp: 0, fp: 0, fn: 0, unanchored: 0, decoy: 0 });
const add = (a: Raw, b: Raw): Raw => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn, unanchored: a.unanchored + b.unanchored, decoy: a.decoy + b.decoy });

export function finish(x: Raw): Tally {
  const precision = x.tp / Math.max(1, x.tp + x.fp);
  const recall = x.tp / Math.max(1, x.tp + x.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { ...x, precision, recall, f1 };
}

/** Score the findings of the given passes on the given drafts. Only passes
 *  that ran are scored, so a run of three passes is not charged with the
 *  misses of the other six. */
export function score(findings: Finding[], passesRun: Map<string, Set<string>>) {
  const byPass = new Map<string, Raw>();
  const byDraft = new Map<string, Raw>();
  const unmatched: Finding[] = [];
  for (const [draft, passes] of passesRun) {
    const goldFile = join(CORPUS, `gold-${stem(draft)}.json`);
    if (!existsSync(goldFile)) continue;
    const text = readFileSync(draftPath(draft), "utf8");
    const gold: { category: string; quote: string }[] = JSON.parse(readFileSync(goldFile, "utf8"));
    const keyFile = join(CORPUS, `key-${stem(draft)}.json`);
    const decoys: { category: string; quote: string }[] = existsSync(keyFile)
      ? JSON.parse(readFileSync(keyFile, "utf8")).filter((k: any) => k.kind === "decoy")
      : [];
    for (const pass of passes) {
      const t = zero();
      const g = gold
        .filter((x) => x.category === pass)
        .map((x) => locateAll(text, x.quote).map((s) => widen(text, s, pass)))
        .filter((o) => o.length);
      const used = new Set<number>();
      const d = decoys.filter((x) => x.category === pass).map((x) => locate(text, x.quote)).filter(Boolean) as Span[];
      for (const f of findings.filter((f) => f.draft === draft && f.pass === pass)) {
        const occ = locateAll(text, f.quote);
        if (!occ.length) { t.unanchored++; t.fp++; unmatched.push(f); continue; }
        const ws = occ.map((o) => widen(text, o, pass));
        const hit = g.findIndex((x, i) => !used.has(i) && x.some((gs) => ws.some((w) => overlap(gs, w))));
        if (hit >= 0) { used.add(hit); t.tp++; continue; }
        t.fp++;
        unmatched.push(f);
        if (d.some((x) => overlap(x, occ[0]!))) t.decoy++;
      }
      t.fn += g.length - used.size;
      byPass.set(pass, add(byPass.get(pass) ?? zero(), t));
      byDraft.set(draft, add(byDraft.get(draft) ?? zero(), t));
    }
  }
  if (byPass.size === 0) return { scores: null, unmatched };
  const overall = [...byPass.values()].reduce(add, zero());
  const map = (m: Map<string, Raw>) => Object.fromEntries([...m].sort().map(([k, v]) => [k, finish(v)]));
  return { scores: { overall: finish(overall), byPass: map(byPass), byDraft: map(byDraft) }, unmatched };
}

/** The passes each draft ran, from a result's pass calls. */
export function passesRun(r: Pick<Result, "calls">): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const c of r.calls) if (c.stage === "pass") m.set(c.draft, (m.get(c.draft) ?? new Set()).add(c.pass));
  return m;
}

/** A draft built by `join.ts` has a map beside it. */
function mapOf(draft: string): JoinMap | null {
  const file = join(CORPUS, `${stem(draft)}-map.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** Move the findings on a joined draft back to the drafts they lie in. A
 *  finding lies where its quote occurs in the paragraph its call examined,
 *  or, without one, at the quote's first occurrence in the joined text. A
 *  finding in the padding is dropped and counted as `outside`. A quote
 *  found nowhere stays with the draft of its paragraph, where the scorer
 *  counts it as unanchored. */
export function unjoin(r: Pick<Result, "calls" | "findings">) {
  const findings: Finding[] = [];
  const run = new Map<string, Set<string>>();
  let outside = 0;
  for (const [draft, passes] of passesRun(r)) {
    const map = mapOf(draft);
    if (!map) {
      run.set(draft, new Set([...(run.get(draft) ?? []), ...passes]));
      findings.push(...r.findings.filter((x) => x.draft === draft));
      continue;
    }
    for (const p of map.parts) if (p.scored) run.set(p.source, new Set([...(run.get(p.source) ?? []), ...passes]));
    const text = readFileSync(draftPath(draft), "utf8");
    const paras = paragraphs(text);
    const starts: number[] = [];
    let at = 0;
    for (const p of paras) {
      at = text.indexOf(p, at);
      starts.push(at);
      at += p.length;
    }
    const partAt = (i: number) => map.parts.find((p) => i >= p.from && i < p.to) ?? null;
    for (const f of r.findings.filter((x) => x.draft === draft)) {
      if (!passes.has(f.pass)) continue;
      const chunk = f.chunk ?? null;
      let pos: number | null = null;
      if (chunk !== null) {
        const inPara = locateAll(paras[chunk]!, f.quote)[0];
        if (inPara) pos = starts[chunk]! + inPara.from;
      }
      pos ??= locateAll(text, f.quote)[0]?.from ?? null;
      const part = partAt(pos ?? (chunk !== null ? starts[chunk]! : 0));
      if (!part || !part.scored) {
        outside++;
        continue;
      }
      findings.push({ ...f, draft: part.source });
    }
  }
  return { findings, passesRun: run, outside };
}

/** Score a result. Findings on a joined draft are scored on the drafts it
 *  joins. */
export function scoreResult(r: Pick<Result, "calls" | "findings">, skip: string[] = []) {
  const u = unjoin(r);
  for (const set of u.passesRun.values()) for (const p of skip) set.delete(p);
  return { ...score(u.findings, u.passesRun), outside: u.outside };
}

const pct = (n: number) => (100 * n).toFixed(0).padStart(3) + "%";
export function describe(label: string, s: NonNullable<ReturnType<typeof score>["scores"]>, byPass: boolean): string {
  const o = s.overall;
  const lines = [`${label}\n  overall            P ${pct(o.precision)}  R ${pct(o.recall)}  F1 ${pct(o.f1)}  tp ${o.tp} fp ${o.fp} fn ${o.fn}  unanchored ${o.unanchored}  decoy ${o.decoy}`];
  if (byPass) for (const [p, x] of Object.entries(s.byPass)) {
    lines.push(`  ${p.padEnd(18)} P ${pct(x.precision)}  R ${pct(x.recall)}  F1 ${pct(x.f1)}  tp ${x.tp} fp ${x.fp} fn ${x.fn}  unanch ${x.unanchored}  decoy ${x.decoy}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: bun bench/scripts/score.ts <result.json> [--by-pass] [--dump file]");
  const r: Result = JSON.parse(readFileSync(file, "utf8"));
  // --skip a,b scores the other passes only, to compare with a run that
  // did not have them.
  const si = process.argv.indexOf("--skip");
  const skip = si >= 0 ? process.argv[si + 1]!.split(",") : [];
  const { scores, unmatched, outside } = scoreResult(r, skip);
  if (!scores) console.log(`${r.label}: no draft with reference findings`);
  else console.log(describe(r.label, scores, process.argv.includes("--by-pass")));
  if (outside) console.log(`  ${outside} finding(s) in unscored padding`);
  const di = process.argv.indexOf("--dump");
  if (di >= 0) writeFileSync(process.argv[di + 1]!, JSON.stringify(unmatched, null, 2));
}
