/** Tidying the edges of drawn ranges (SPEC §12.3).
 *
 *  Models are loose about where a quote starts and stops. One includes the
 *  full stop, the next stops before it, a third starts with the space before
 *  the first word. Drawn as given, overlapping highlights end a character
 *  apart and look like a mistake. This tidies what is drawn. The stored quote
 *  is never changed.
 *
 *  Offsets are code points into the plain text, the same units Rust returns,
 *  so this runs before they are mapped to ProseMirror positions. */

export interface Range {
  from: number;
  to: number;
}

/** Never the first character of a range. */
const LEADING = /[\s,;:.]/u;
/** Never the last character of a range. */
const TRAILING = /\s/u;
/** What an end may move over to meet another end. */
const CLOSING = /[.,;:!?"'”’)\]»]/u;
/** What a start may move over to meet another start. */
const OPENING = /["'“‘(\[«]/u;

function trim(chars: string[], r: Range): Range {
  let { from, to } = r;
  while (from < to && LEADING.test(chars[from]!)) from++;
  while (to > from && TRAILING.test(chars[to - 1]!)) to--;
  // Rule 3: a range tidying would empty is drawn as placed.
  // Always a copy: rule 2 moves ends in place.
  return from < to ? { from, to } : { ...r };
}

function only(chars: string[], from: number, to: number, set: RegExp): boolean {
  for (let i = from; i < to; i++) if (!set.test(chars[i]!)) return false;
  return true;
}

const overlap = (a: Range, b: Range) => a.from < b.to && b.from < a.to;

/** Tidy every range against the text. Unplaced ranges stay null, and the
 *  result lines up with the input index for index. */
export function tidy(text: string, ranges: (Range | null)[]): (Range | null)[] {
  const chars = Array.from(text);
  const out = ranges.map((r) =>
    !r ? null : r.from >= 0 && r.to <= chars.length && r.from < r.to ? trim(chars, r) : { ...r },
  );

  // Rule 2. Moving one end can bring it level with a third range's, so repeat
  // until nothing moves. Each move only ever widens a range, so this ends.
  for (let changed = true; changed; ) {
    changed = false;
    for (const a of out) {
      if (!a) continue;
      for (const b of out) {
        if (!b || a === b || !overlap(a, b)) continue;
        if (a.to < b.to && only(chars, a.to, b.to, CLOSING)) {
          a.to = b.to;
          changed = true;
        }
        if (b.from < a.from && only(chars, b.from, a.from, OPENING)) {
          a.from = b.from;
          changed = true;
        }
      }
    }
  }
  return out;
}
