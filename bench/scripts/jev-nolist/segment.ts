/** Language-neutral segmentation: Intl.Segmenter, nothing else. No word
 *  list, no suffix pattern, no per-language marker set. This is the only
 *  code in bench/scripts/jev-nolist/ allowed to touch text below the
 *  sentence level, and it decides nothing about what gets flagged — it only
 *  cuts the draft into units Jev can be asked about, and measures a span
 *  Jev already chose. */

export interface Span {
  text: string;
  from: number;
  to: number;
}

/** Trims a raw [from, to) slice and moves the bounds in to match, so an
 *  offset found inside the trimmed text still lands correctly against the
 *  original string. */
function trimmed(text: string, rawFrom: number, rawTo: number): Span | null {
  const raw = text.slice(rawFrom, rawTo);
  const from = rawFrom + (raw.length - raw.trimStart().length);
  const to = rawTo - (raw.length - raw.trimEnd().length);
  return from < to ? { text: text.slice(from, to), from, to } : null;
}

/** Sentences of one paragraph (or any text), via Intl.Segmenter's Unicode
 *  sentence-break rules. No locale is pinned, so this runs the same way
 *  whatever language the draft is in. */
export function sentencesOf(text: string): Span[] {
  const seg = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const out: Span[] = [];
  for (const s of seg.segment(text)) {
    const t = trimmed(text, s.index, s.index + s.segment.length);
    if (t) out.push(t);
  }
  return out;
}

/** Word-like segments of one sentence (or any text), via Intl.Segmenter's
 *  word-break rules. `isWordLike` is the segmenter's own classification of
 *  a segment as a word rather than space or punctuation — part of the
 *  Unicode algorithm, not a list this code maintains. */
export function wordsOf(text: string): Span[] {
  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const out: Span[] = [];
  for (const s of seg.segment(text)) {
    if (s.isWordLike) out.push({ text: s.segment, from: s.index, to: s.index + s.segment.length });
  }
  return out;
}

/** How many word-like segments of `text` fall strictly before `at`. Used
 *  only to turn a span Jev already chose into a severity band the rule
 *  itself states in numbers — never to decide what gets flagged. */
export function wordsBefore(text: string, at: number): number {
  return wordsOf(text).filter((w) => w.to <= at).length;
}
