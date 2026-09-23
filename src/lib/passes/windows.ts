/** Splitting a long draft into windows for paragraph-scope calls (SPEC §8.3).
 *
 *  A window is a core of whole paragraphs, which its calls examine, and up to
 *  MARGIN paragraphs of context on either side, which they do not. Every
 *  paragraph is in exactly one core. Core boundaries come from the
 *  paragraphs' text, so an edit moves only the boundaries near it and the
 *  other windows send the same text as before. */

/** A draft this long or shorter is one window: the whole draft. */
export const SINGLE = 16_000;
/** A core is at least this long before its text may end it... */
export const MIN_CORE = 4_000;
/** ...and never longer than this, unless one paragraph is. */
export const MAX_CORE = 12_000;
/** Paragraphs of context on either side of a core. */
export const MARGIN = 3;

export interface Window {
  /** Indices into the paragraph list: the core is [from, to). */
  from: number;
  to: number;
  /** The text the calls send: context and core, joined as paragraphs. */
  text: string;
  /** False when the window is the whole draft. */
  excerpt: boolean;
}

/** FNV-1a, 32 bits. Enough to scatter boundaries; not a key. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The windows for a draft's paragraphs, in order. `draft` is the whole text,
 *  used when it fits in one window, so a short draft is sent exactly as it
 *  is. */
export function windows(paragraphs: string[], draft: string): Window[] {
  if (paragraphs.length === 0) return [];
  if (draft.length <= SINGLE) {
    return [{ from: 0, to: paragraphs.length, text: draft, excerpt: false }];
  }

  const cores: [number, number][] = [];
  let from = 0;
  let size = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const len = paragraphs[i]!.length;
    // A paragraph that would take the core past its limit starts a new one.
    if (i > from && size + len > MAX_CORE) {
      cores.push([from, i]);
      from = i;
      size = 0;
    }
    size += len;
    if (size >= MIN_CORE && fnv1a(paragraphs[i]!) % 4 === 0) {
      cores.push([from, i + 1]);
      from = i + 1;
      size = 0;
    }
  }
  if (from < paragraphs.length) cores.push([from, paragraphs.length]);

  return cores.map(([from, to]) => {
    const start = Math.max(0, from - MARGIN);
    const end = Math.min(paragraphs.length, to + MARGIN);
    return { from, to, text: paragraphs.slice(start, end).join("\n\n"), excerpt: true };
  });
}

/** The window whose core holds paragraph `i`. */
export function windowOf(list: Window[], i: number): Window {
  const w = list.find((w) => i >= w.from && i < w.to);
  if (!w) throw new Error(`paragraph ${i} is in no window`);
  return w;
}
