/** The second stage of a pass that does not think (SPEC §8.3).
 *
 *  Three verifiers each see the draft, the pass's rule and the numbered
 *  candidates, and answer keep or drop for each. A candidate stays when two
 *  keep it. The verifier returns numbers and flags only, so no model wording
 *  reaches the draft by this path. */
import { extractArray } from "./parse";

export const VOTES = 3;
export const NEED = 2;

export const VERIFY_SYSTEM =
  "You are a senior copyeditor checking another editor's findings. " +
  "You accept a finding only when it clearly meets the rule. You never rewrite the draft.";

/** The draft comes first, as in a pass prompt, so the three votes share a
 *  cached prefix. */
export function buildVerifyPrompt(
  rule: string,
  draft: string,
  candidates: { quote: string; note: string }[],
): string {
  const list = candidates
    .map((c, i) => `${i + 1}. quote: ${JSON.stringify(c.quote)}\n   note: ${JSON.stringify(c.note)}`)
    .join("\n");
  return [
    "--- the draft ---",
    draft,
    "",
    "--- the rule ---",
    rule.trim(),
    "",
    "--- candidates ---",
    list,
    "",
    "--- the task ---",
    'For each candidate, apply the rule exactly, including its "Do not flag" list. Keep it if a ' +
      "careful editor applying this rule would report it. Drop it if it fails the rule's test, if " +
      "the rule says not to flag it, if it belongs to a different kind of problem, if its note says " +
      "there is no problem, or if it repeats an earlier candidate about the same words.",
    "",
    'Reply as JSON: an array with one item per candidate, {"id": <number>, "keep": true or false}.',
  ].join("\n");
}

/** One verifier's flags, one per candidate, or null when the reply cannot be
 *  read. A candidate the reply does not mention is dropped. With a single
 *  candidate, verifiers often answer with a bare object, so that counts too. */
export function parseVerdicts(text: string, count: number): boolean[] | null {
  let items: unknown[];
  const json = extractArray(text);
  try {
    if (json !== null) items = JSON.parse(json);
    else {
      const one = text.match(/\{[^{}]*"keep"[^{}]*\}/)?.[0];
      if (!one) return null;
      items = [JSON.parse(one)];
    }
  } catch {
    return null;
  }
  if (!Array.isArray(items)) return null;
  const keep = new Array<boolean>(count).fill(false);
  let read = 0;
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { id, keep: k } = item as { id?: unknown; keep?: unknown };
    const i = Number(id) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= count || typeof k !== "boolean") continue;
    keep[i] = k;
    read += 1;
  }
  return read > 0 ? keep : null;
}

/** Which candidates stay. Unreadable votes do not count. With no readable
 *  vote at all, every candidate stays: a failed check must not empty a pass. */
export function tally(votes: (boolean[] | null)[], count: number, need = NEED): boolean[] {
  const read = votes.filter((v): v is boolean[] => v !== null);
  if (read.length === 0) return new Array<boolean>(count).fill(true);
  const bar = Math.min(need, read.length);
  return Array.from({ length: count }, (_, i) => read.filter((v) => v[i]).length >= bar);
}
