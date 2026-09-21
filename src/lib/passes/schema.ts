/** The findings contract (SPEC 10).
 *
 *  There is no field for replacement wording and no field for praise. That is
 *  the enforcement mechanism: the model has nowhere to put either one. */
import { z } from "zod";
import type { Rules } from "../ipc";

export const CONTEXT_LEN = 32;

export const FindingElement = z.object({
  quote: z
    .string()
    // Two characters is deliberately permissive. A filler-words pass has every
    // right to quote "so", and a short quote still anchors, because it is
    // placed with thirty-two characters of context either side. The upper
    // bound is the real one: past four hundred characters a quote is a
    // paragraph, and a paragraph will not survive being rewritten.
    .min(2)
    .max(400)
    .describe(
      "Exact text from the draft, copied verbatim. At most four hundred characters.",
    ),
  prefix: z
    .string()
    .default("")
    .describe(
      `The ${CONTEXT_LEN} characters immediately before the quote, verbatim. Empty if the quote starts the draft.`,
    ),
  suffix: z
    .string()
    .default("")
    .describe(
      `The ${CONTEXT_LEN} characters immediately after the quote, verbatim. Empty if the quote ends the draft.`,
    ),
  category: z.string().describe("A short slug for the kind of problem."),
  severity: z.enum(["low", "medium", "high"]),
  note: z
    .string()
    .describe(
      "What is wrong with this text. Name the problem. Do not write a replacement, do not suggest wording, do not praise.",
    ),
});

export type FindingElement = z.infer<typeof FindingElement>;

const BASE = `You are a copyeditor examining a draft. You report problems. You do not fix them.`;

const NO_SUGGESTIONS = `- Never suggest replacement wording. Never write an improved version of any
  sentence, phrase or word. Name the problem and stop.`;

const NO_PRAISE = `- Never praise, encourage, compliment or reassure. No positive assessment of
  any kind, at any scale, including in passing.`;

const ALWAYS = `- Do not comment on the subject matter or on whether you agree with it.
- Quote verbatim from the draft. Never paraphrase a quote.
- Finding nothing is a normal result. Return an empty array.`;

/** Build the preamble from the rules in config.toml. Both rules are settings
 *  (SPEC 2); the defaults are strict. */
export function preamble(rules: Rules): string {
  const lines = [BASE, "", "Rules, without exception:"];
  if (!rules.allowSuggestions) lines.push(NO_SUGGESTIONS);
  if (rules.forbidPraise) lines.push(NO_PRAISE);
  lines.push(ALWAYS);
  return lines.join("\n");
}

/** The instruction appended to every pass prompt, describing the output.
 *
 *  The word "json" has to appear here. DeepSeek, and other OpenAI-compatible
 *  endpoints, reject a request that asks for `response_format: json_object`
 *  without it. Saying so costs nothing on providers that do not care. */
export function outputNote(): string {
  return [
    "",
    "Reply as JSON: an array of findings.",
    "For each problem you find, return one item with:",
    "- quote: the exact words from the draft, copied character for character",
    `- prefix and suffix: the ${CONTEXT_LEN} characters either side of the quote, verbatim`,
    "- category, severity, and a note naming the problem",
    "",
    "The quote must appear in the draft exactly as you write it. If you cannot",
    "copy it exactly, leave the problem out.",
  ].join("\n");
}
