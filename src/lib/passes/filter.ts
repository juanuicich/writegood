/** Code filters on a pass's candidates, before they are verified (SPEC §8.3).
 *
 *  Both drop only what cannot be right. A model asked about one paragraph
 *  still sees the whole draft, and it reports problems elsewhere; several
 *  paragraph calls then report the same problem. */

/** Markdown emphasis and code marks. A model often quotes without them. */
const MARKS = /[*_`]/g;

const bare = (text: string) => text.replace(MARKS, "");

/** Keep the findings whose quote lies in the paragraph the call examined. */
export function inParagraph<T extends { quote: string }>(found: T[], paragraph: string): T[] {
  const plain = bare(paragraph);
  return found.filter((f) => paragraph.includes(f.quote) || plain.includes(bare(f.quote)));
}

/** Remembers the quotes a pass has reported, and drops a later finding whose
 *  quote contains an earlier one or is contained in it. A quote that occurs
 *  more than once in the draft is never dropped, because each occurrence can
 *  be a problem of its own. Case is ignored. */
export class Repeats {
  private readonly draft: string;
  private readonly seen: string[] = [];

  constructor(draft: string) {
    this.draft = bare(draft).toLowerCase();
  }

  take<T extends { quote: string }>(found: T[]): T[] {
    return found.filter((f) => {
      const q = bare(f.quote).trim().toLowerCase();
      if (q.length === 0) return true;
      const once = this.draft.split(q).length === 2;
      if (once && this.seen.some((s) => s.includes(q) || q.includes(s))) return false;
      this.seen.push(q);
      return true;
    });
  }
}
