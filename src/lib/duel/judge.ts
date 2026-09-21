/** The parts of the duel (SPEC 11) that do not touch the app: shuffling the
 *  two versions, building the judge's prompt, and reading a verdict back out
 *  of a model reply.
 *
 *  The judge must never learn which passage the author wrote later. Nothing in
 *  here says that a passage was edited, or that one came from the other. */
import { z } from "zod";

export type Choice = "A" | "B" | "tie";

export interface Verdict {
  verdict: Choice;
  reason: string;
}

/** Models are inconsistent about the case of a one-letter answer, so the
 *  schema normalises it rather than rejecting a reply that is otherwise
 *  correct. */
function normaliseCase(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.verdict !== "string") return raw;
  const v = obj.verdict.trim().toLowerCase();
  return { ...obj, verdict: v === "a" ? "A" : v === "b" ? "B" : v };
}

export const VerdictSchema: z.ZodType<Verdict> = z.preprocess(
  normaliseCase,
  z.object({
    verdict: z.enum(["A", "B", "tie"]),
    reason: z.string().min(1).describe("One sentence naming why."),
  }),
);

/**
 * Decide which side the author's own text is shown as.
 *
 * The result is stored with the duel, so `original_won` is derived once at
 * write time and the shuffle never has to be unpicked later.
 */
export function shuffle(
  original: string,
  rewrite: string,
  rand: () => number = Math.random,
): { aText: string; bText: string; aIsOriginal: boolean } {
  const aIsOriginal = rand() < 0.5;
  return aIsOriginal
    ? { aText: original, bText: rewrite, aIsOriginal: true }
    : { aText: rewrite, bText: original, aIsOriginal: false };
}

const SYSTEM = [
  "You judge prose. You are given two passages, A and B. You say which one is better written.",
  "",
  "Rules, without exception:",
  "- Judge the writing only: clarity, precision, rhythm, and how much work each word does.",
  "- Never praise either passage. Give a judgement, not encouragement.",
  "- Do not comment on the subject matter or on whether you agree with it.",
  "- If neither is better, the verdict is a tie.",
  "",
  "Reply as JSON, one object:",
  '{"verdict": "A" or "B" or "tie", "reason": "one sentence"}',
  "",
  "The reason is one sentence. Say nothing outside the JSON object.",
].join("\n");

/**
 * The judge's prompt.
 *
 * It carries no hint of which passage is newer: no vendor, no history, no word
 * about where either passage came from. `judgePrompt(x, y)` and
 * `judgePrompt(y, x)` differ only by the two passages swapped.
 */
export function judgePrompt(aText: string, bText: string): { system: string; prompt: string } {
  const prompt = [
    "Passage A:",
    "",
    aText,
    "",
    "Passage B:",
    "",
    bText,
    "",
    "Which passage is better written? Reply as JSON.",
  ].join("\n");
  return { system: SYSTEM, prompt };
}

/** Pull the first JSON object out of a reply that may carry a preamble, a
 *  fenced block, or trailing chatter. The same tolerance as `parse.ts`; the
 *  CLI backend in particular is not reliable about structured output. */
export function extractObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Recover the two fields from an object that will not parse as JSON.
 *
 * The judge quotes words from the passages it is comparing, and it does not
 * always escape those quotes: a reason like `repetition of "decide," A uses`
 * kills `JSON.parse` and throws away a real verdict. One reply in ten was
 * being lost to this.
 *
 * Deliberately not a JSON repairer. Two fields, one shape. The reason runs
 * from the quote after the `reason` key to the last quote before the closing
 * brace, so unescaped quotes inside it are simply part of the text.
 */
function salvage(json: string): unknown {
  const verdict = json.match(/"verdict"\s*:\s*"([^"]*)"/);
  const reason = json.match(/"reason"\s*:\s*"([\s\S]*)"\s*\}\s*$/);
  if (verdict === null || reason === null) return null;
  return {
    verdict: verdict[1],
    reason: reason[1]!.replace(/\\(["\\])/g, "$1"),
  };
}

/**
 * Read a verdict out of a model reply.
 *
 * Well-formed JSON takes the strict path. Only a reply that will not parse
 * falls through to `salvage`, and the schema judges both the same way.
 */
export function parseVerdict(text: string, who = "the judge"): Verdict {
  const json = extractObject(text);
  if (json === null) throw new Error(`${who} returned no JSON object`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = salvage(json);
    if (parsed === null) throw new Error(`${who} returned JSON that will not parse`);
  }

  const result = VerdictSchema.safeParse(parsed);
  if (!result.success) throw new Error(`${who} returned a verdict that does not fit the schema`);
  return result.data;
}

/** Did the author's own version win? `null` for a tie. */
export function originalWon(verdict: Choice, aIsOriginal: boolean): boolean | null {
  if (verdict === "tie") return null;
  return verdict === "A" ? aIsOriginal : !aIsOriginal;
}

/** The running score across recorded duels: how often the author's rewrite
 *  actually beat the version it replaced. Near chance means the passes are
 *  wasting the author's time (SPEC 11). */
export function tally(duels: { originalWon: boolean | null }[]): {
  total: number;
  original: number;
  rewrite: number;
  ties: number;
} {
  let original = 0;
  let rewrite = 0;
  let ties = 0;
  for (const d of duels) {
    if (d.originalWon === null) ties++;
    else if (d.originalWon) original++;
    else rewrite++;
  }
  return { total: duels.length, original, rewrite, ties };
}
