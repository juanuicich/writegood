/** Rule One guard (SPEC 10.3).
 *
 *  Models leak replacement wording into prose notes even when the schema has
 *  nowhere to put it and the preamble forbids it. This finds quoted spans in a
 *  note that do not appear in the draft, which is the signature of the model
 *  writing your sentence for you, and hides them until you ask.
 *
 *  It is deliberately mechanical. A guard that tried to judge intent would be
 *  wrong more often and would be harder to reason about. */

export interface Segment {
  text: string;
  /** True when this span is the model's own wording, not yours. */
  redacted: boolean;
}

/** Straight and curly quotes, plus the usual typographic pairs. */
const QUOTED = /["“”'‘’«»](.+?)["“”'‘’«»]/gu;

const MIN_WORDS = 3;

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Loose comparison: a quote that differs only in case, punctuation or
 *  whitespace is still your wording. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a note into segments, marking those that quote wording absent from
 * the draft. `draft` is the document's plain text.
 */
export function guard(note: string, draft: string, enabled = true): Segment[] {
  if (!enabled) return [{ text: note, redacted: false }];

  const haystack = normalise(draft);
  const out: Segment[] = [];
  let last = 0;

  for (const m of note.matchAll(QUOTED)) {
    const whole = m[0];
    const inner = m[1];
    const at = m.index ?? 0;
    if (words(inner) < MIN_WORDS) continue;
    const needle = normalise(inner);
    if (!needle || haystack.includes(needle)) continue;

    if (at > last) out.push({ text: note.slice(last, at), redacted: false });
    out.push({ text: whole, redacted: true });
    last = at + whole.length;
  }

  if (last < note.length) out.push({ text: note.slice(last), redacted: false });
  return out.length > 0 ? out : [{ text: note, redacted: false }];
}

/** True when a note contains anything the guard would hide. */
export function leaks(note: string, draft: string): boolean {
  return guard(note, draft).some((s) => s.redacted);
}
