/** Build `corpus/joined.md`: the four scored drafts in one document longer
 *  than one window (SPEC §8.3), so a run can measure quality with windows.
 *
 *  bun bench/scripts/join.ts [--target 18000]
 *
 *  The four drafts hold 9,834 characters, less than the 16,000 of one
 *  window. Paragraphs from the start of `chapter.md` follow them until the
 *  document passes `--target` characters. That padding has no reference,
 *  and the scorer ignores findings in it.
 *
 *  It writes `corpus/joined-map.json`: where each part lies in the joined
 *  text, and every reference item of the four drafts with its position in
 *  the joined text. Positions are Unicode scalar values, as in the app.
 *  `score.ts` reads the map. It moves each finding back to the draft it
 *  lies in and scores it against that draft's reference, so a finding
 *  matches exactly what it would match in the draft alone. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paragraphs } from "../../src/lib/passes/parse";
import { windows } from "../../src/lib/passes/windows";
import { CORPUS, flag, SCORED, stem } from "./lib";

export const JOINED = "joined.md";
export const PADDING = "chapter.md";

export interface Part {
  source: string;
  /** False for the padding, which has no reference. */
  scored: boolean;
  /** UTF-16 offsets into the joined text, [from, to). */
  from: number;
  to: number;
}

export interface JoinMap {
  built: string;
  target: number;
  parts: (Part & { fromScalar: number; toScalar: number })[];
  gold: { source: string; category: string; quote: string; from: number; to: number }[];
}

const scalar = (text: string, at: number) => Array.from(text.slice(0, at)).length;

if (import.meta.main) {
  const target = Number(flag("--target", "18000"));
  const pieces: { source: string; scored: boolean; text: string }[] = SCORED.map((d) => ({
    source: d, scored: true, text: readFileSync(join(CORPUS, d), "utf8").trim(),
  }));
  const pad: string[] = [];
  const length = () => [...pieces.map((p) => p.text), pad.join("\n\n")].filter(Boolean).join("\n\n").length;
  for (const p of paragraphs(readFileSync(join(CORPUS, PADDING), "utf8"))) {
    if (length() > target) break;
    pad.push(p);
  }
  pieces.push({ source: PADDING, scored: false, text: pad.join("\n\n") });

  let text = "";
  const parts: JoinMap["parts"] = [];
  for (const p of pieces) {
    if (text) text += "\n\n";
    const from = text.length;
    text += p.text;
    parts.push({ source: p.source, scored: p.scored, from, to: text.length, fromScalar: scalar(text, from), toScalar: scalar(text, text.length) });
  }
  text += "\n";

  // Each reference item at its first occurrence in its own draft, moved by
  // the draft's offset. The scorer does the same search in the draft alone.
  const gold: JoinMap["gold"] = [];
  for (const part of parts.filter((p) => p.scored)) {
    const own = text.slice(part.from, part.to);
    const items: { category: string; quote: string }[] = JSON.parse(readFileSync(join(CORPUS, `gold-${stem(part.source)}.json`), "utf8"));
    for (const g of items) {
      const quote = own.includes(g.quote) ? g.quote : g.quote.replace(/\*+/g, "").trim();
      const at = own.indexOf(quote);
      if (at < 0) throw new Error(`${part.source}: reference quote not found: ${g.quote}`);
      const from = part.from + at;
      gold.push({ source: part.source, category: g.category, quote: g.quote, from: scalar(text, from), to: scalar(text, from + quote.length) });
    }
  }

  const map: JoinMap = { built: "bench/scripts/join.ts", target, parts, gold };
  writeFileSync(join(CORPUS, JOINED), text);
  writeFileSync(join(CORPUS, "joined-map.json"), JSON.stringify(map, null, 1) + "\n");

  const paras = paragraphs(text);
  console.log(`${JOINED}: ${text.length} characters, ${paras.length} paragraphs, ${gold.length} reference items`);
  for (const p of parts) console.log(`  ${p.source.padEnd(16)} ${p.from}-${p.to}${p.scored ? "" : "  (padding, not scored)"}`);
  // The windows the app would send, by the parts their cores hold.
  const starts: number[] = [];
  let at = 0;
  for (const p of paras) {
    at = text.indexOf(p, at);
    starts.push(at);
    at += p.length;
  }
  const partOf = (i: number) => parts.find((p) => starts[i]! >= p.from && starts[i]! < p.to)!.source;
  for (const w of windows(paras, text)) {
    const held = [...new Set(Array.from({ length: w.to - w.from }, (_, k) => partOf(w.from + k)))];
    console.log(`  window: paragraphs ${w.from + 1}-${w.to}, ${w.text.length} characters sent, core holds ${held.join(", ")}`);
  }
}
