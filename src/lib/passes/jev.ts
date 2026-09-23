/** Passes on Jev, TypeSafe's decision model (SPEC §8.4).
 *
 *  Jev writes no text. It answers typed questions: a Noul gives the
 *  probability that the answer is yes, and a Choice picks one of the options
 *  the caller lists. The pass's rule text is the whole definition of what is
 *  flagged. This file does four things only:
 *
 *  1. It splits a paragraph into sentences and a sentence into words, with
 *     `Intl.Segmenter` and no locale.
 *  2. It lists spans of consecutive words as the options of a Choice.
 *  3. It turns the chosen option into a quote, from the offsets it listed.
 *  4. It removes spans that overlap a span already chosen.
 *
 *  It also builds the questions from the rule text and reads the answers.
 *  No word list, pattern or language-specific rule decides anything here.
 *  Rust makes the request (`jev.rs`). */
import type { JevReply, NewFinding, Pass, Provider, Severity } from "../ipc";
import { Failures, Unreadable } from "./failures";

export { Unreadable };

// ------------------------------------------------------------- constants

/** The longest quote, in words. It bounds a quote; it does not decide what
 *  is flagged. */
export const SPAN_WORDS = 8;
/** The first round and up to three more for other instances. */
export const ROUNDS = 4;
/** TypeSafe's limit on the options of one Choice. */
export const MAX_OPTIONS = 255;
/** The keep threshold when neither the pass nor the provider sets one. */
export const DEFAULT_KEEP = 0.45;
/** Severity from the Noul that kept the sentence (SPEC §8.4). It measures
 *  how sure Jev is, not how serious the problem is. */
export const BANDS = { high: 0.85, medium: 0.65 } as const;
/** The option a later round offers when the sentence has no other instance. */
export const NONE = "none";

/** The fixed question texts of method `sentence`, as the benchmark measured
 *  them (`bench/scripts/jev-nolist/run-rule-choice.ts`). */
export const TEXT = {
  detect:
    "`rule` defines a specific problem an editor looks for in a piece of writing, written for a human editor to apply. " +
    "Read `sentence`, using `paragraph` only for surrounding context. Does `sentence` itself show that problem, per " +
    "`rule`? Answer yes only when `sentence`, not merely the paragraph around it, does what `rule` says to flag, and " +
    "apply every exclusion `rule` itself lists.",
  detectTrue: "`sentence` itself does what `rule` says to flag.",
  detectFalse: "`sentence` does not — including every case `rule`'s own exclusions name.",
  locate:
    "`sentence` shows the problem that `rule` defines. `rule` also says which words to quote for one instance of " +
    "that problem. Each option is a span of consecutive words from `sentence`. Which option is exactly the text " +
    "`rule` says to quote: all of it, and nothing more?",
  locateMore:
    " The instances in `already_quoted` are already reported. Pick a span for a different instance of the " +
    "problem in `sentence`, or `none` if `sentence` has no other instance.",
  none: "`sentence` has no other instance of the problem beyond `already_quoted`.",
} as const;

/** Everything fixed about the method, for the fingerprint (SPEC §8.4). A
 *  change to any of it asks every paragraph again. */
export const METHOD_FINGERPRINT = JSON.stringify({
  text: TEXT,
  spanWords: SPAN_WORDS,
  rounds: ROUNDS,
  maxOptions: MAX_OPTIONS,
  bands: BANDS,
});

// ------------------------------------------------------------- settings

export type JevMethod = "sentence" | "across";

/** A pass's `[jev]` table after the defaults apply. */
export interface JevSettings {
  method: JevMethod;
  keep: number;
  note: string;
}

export class JevSettingsError extends Error {}

/** The `[jev]` table of a pass, with the defaults: method `sentence`; the
 *  pass's keep, else the provider's, else 0.45; the pass's note, else its
 *  name. */
export function jevSettings(pass: Pass, provider: Provider): JevSettings {
  const table = pass.jev ?? {};
  const method = table.method ?? "sentence";
  if (method !== "sentence" && method !== "across") {
    throw new JevSettingsError(`${pass.name}: [jev] method = "${method}" is not "sentence" or "across"`);
  }
  const keep = table.keep ?? provider.keep ?? DEFAULT_KEEP;
  if (!(keep >= 0 && keep <= 1)) {
    throw new JevSettingsError(`${pass.name}: the keep threshold ${keep} is not between 0 and 1`);
  }
  const note = table.note?.trim() || pass.name;
  return { method, keep, note };
}

/** Why a Jev pass cannot run at all, or null when it can (SPEC §8.4). */
export function cannotRun(pass: Pass, settings: JevSettings): string | null {
  if (pass.scope !== "paragraph") {
    return `${pass.name}: a pass on Jev needs scope = "paragraph"; this one is "${pass.scope}"`;
  }
  if (settings.method === "across") {
    return `${pass.name}: [jev] method = "across" is not built yet; use "sentence"`;
  }
  return null;
}

// ---------------------------------------------------------- segmentation

/** A piece of a string, with its offsets in UTF-16 code units. The offsets
 *  cut strings from the text that was segmented and never leave this file. */
export interface Span {
  text: string;
  from: number;
  to: number;
}

/** The sentences of `text`, by the Unicode sentence-break rules, with the
 *  space around each one cut off. No locale is set. */
export function sentencesOf(text: string): Span[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const out: Span[] = [];
  for (const s of segmenter.segment(text)) {
    const raw = s.segment;
    const from = s.index + (raw.length - raw.trimStart().length);
    const to = s.index + raw.trimEnd().length;
    if (from < to) out.push({ text: text.slice(from, to), from, to });
  }
  return out;
}

/** The words of `text`: the segments the Unicode word-break rules mark
 *  `isWordLike`. No locale is set. */
export function wordsOf(text: string): Span[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  const out: Span[] = [];
  for (const s of segmenter.segment(text)) {
    if (s.isWordLike) out.push({ text: s.segment, from: s.index, to: s.index + s.segment.length });
  }
  return out;
}

// ------------------------------------------------------------------ spans

/** A span of words, as the indices of its first and last word. */
export type WordSpan = readonly [first: number, last: number];

/** Every span of one to `limit` consecutive words of `count` words. When
 *  there are more than `max`, the longest length leaves the list first,
 *  until the list fits. A sentence so long that its single words pass
 *  `max` keeps its first `max` words. */
export function spansOf(count: number, limit = SPAN_WORDS, max = MAX_OPTIONS): WordSpan[] {
  const list = (n: number) => {
    const out: WordSpan[] = [];
    for (let a = 0; a < count; a++) for (let b = a; b < Math.min(count, a + n); b++) out.push([a, b]);
    return out;
  };
  let n = limit;
  let all = list(n);
  while (n > 1 && all.length > max) all = list(--n);
  return all.length > max ? all.slice(0, max) : all;
}

/** The spans that share no word with a span already chosen. */
export function withoutOverlaps(all: readonly WordSpan[], chosen: readonly WordSpan[]): WordSpan[] {
  return all.filter(([a, b]) => !chosen.some(([c, d]) => a <= d && c <= b));
}

/** The option key of a span. */
export const optionKey = ([a, b]: WordSpan) => `${a}-${b}`;

/** The options of a Choice: each span's key, described by the exact text of
 *  the span in `sentence`. */
export function optionsOf(sentence: string, words: Span[], spans: readonly WordSpan[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (const s of spans) options[optionKey(s)] = sentence.slice(words[s[0]]!.from, words[s[1]]!.to);
  return options;
}

// -------------------------------------------------------------- questions

export interface NoulQuestion {
  type: "noul";
  instructions: Record<string, unknown>;
  criteria: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: Record<string, unknown>;
  criteria: Record<string, string>;
}

/** The detect request: one Noul per sentence, keyed `s0`, `s1` and on. Each
 *  carries the rule text, the paragraph and the sentence. */
export function detectQuestions(rule: string, paragraph: string, sentences: Span[]): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  sentences.forEach((s, i) => {
    questions[`s${i}`] = {
      type: "noul",
      instructions: { rule, paragraph, sentence: s.text, question: TEXT.detect },
      criteria: { true: TEXT.detectTrue, false: TEXT.detectFalse },
    };
  });
  return questions;
}

/** One locate round: a Choice over the spans in `options`. A later round
 *  names the quotes already chosen and adds `none`. */
export function locateQuestion(
  rule: string,
  sentence: string,
  options: Record<string, string>,
  already: string[],
): ChoiceQuestion {
  const first = already.length === 0;
  return {
    type: "choice",
    instructions: {
      rule,
      sentence,
      ...(first ? {} : { already_quoted: already }),
      question: TEXT.locate + (first ? "" : TEXT.locateMore),
    },
    criteria: first ? { ...options } : { ...options, [NONE]: TEXT.none },
  };
}

// ---------------------------------------------------------------- answers

function answersOf(reply: JevReply): Record<string, unknown> {
  if (reply.unreadable) throw new Unreadable(reply.unreadable);
  const a = reply.answers;
  if (typeof a !== "object" || a === null || Array.isArray(a)) throw new Unreadable("jev returned no answers");
  return a as Record<string, unknown>;
}

/** The probability of each Noul in a detect reply, in sentence order. */
export function readNouls(reply: JevReply, count: number): number[] {
  const answers = answersOf(reply);
  return Array.from({ length: count }, (_, i) => {
    const a = answers[`s${i}`] as { type?: unknown; noul?: unknown } | undefined;
    if (!a) throw new Unreadable(`jev returned no answer for sentence ${i + 1}`);
    if (a.type !== "noul" || typeof a.noul !== "number" || !(a.noul >= 0 && a.noul <= 1)) {
      throw new Unreadable(`jev's answer for sentence ${i + 1} is not a Noul probability`);
    }
    return a.noul;
  });
}

/** The option a Choice picked. It must be one of `options`, or `none` when
 *  `none` was offered. */
export function readChoice(reply: JevReply, key: string, options: Record<string, unknown>): string {
  const answers = answersOf(reply);
  const a = answers[key] as { type?: unknown; choice?: unknown } | undefined;
  if (!a) throw new Unreadable("jev returned no answer for the quote");
  if (a.type !== "choice" || typeof a.choice !== "string") throw new Unreadable("jev's answer for the quote is not a Choice");
  if (!Object.hasOwn(options, a.choice)) throw new Unreadable(`jev chose "${a.choice}", which is not one of the options`);
  return a.choice;
}

export function severity(p: number): Severity {
  if (p >= BANDS.high) return "high";
  if (p >= BANDS.medium) return "medium";
  return "low";
}

// ------------------------------------------------------------------ quotes

/** The quote, prefix and suffix of a span of a paragraph. `from` and `to`
 *  are UTF-16 offsets in `paragraph`. `points` is the draft as
 *  `Array.from` splits it, and `start` is where the paragraph starts in it,
 *  in Unicode scalar values (SPEC §7). Nothing searches the draft. */
export function quoteAt(
  points: string[],
  start: number,
  paragraph: string,
  from: number,
  to: number,
): { quote: string; prefix: string; suffix: string } {
  const at = start + Array.from(paragraph.slice(0, from)).length;
  const end = at + Array.from(paragraph.slice(from, to)).length;
  return {
    quote: points.slice(at, end).join(""),
    prefix: points.slice(Math.max(0, at - 32), at).join(""),
    suffix: points.slice(end, end + 32).join(""),
  };
}

// ----------------------------------------------------------------- method

/** Sends one request. The state is the paragraph. Null means the pass has
 *  stopped, and the paragraph's answer is then not saved. */
export type Ask = (state: string, questions: Record<string, NoulQuestion | ChoiceQuestion>) => Promise<JevReply | null>;

/** Where a paragraph sits in the draft, for quotes. */
export interface Place {
  points: string[];
  start: number;
}

/** Stopped: the pass failed elsewhere, so this paragraph's answer is not
 *  saved. */
export const STOPPED = null;

/** Method `sentence` for one paragraph (SPEC §8.4): one detect request with
 *  a Noul per sentence, then locate rounds for each sentence kept. Returns
 *  the findings, or null when the pass stopped. Throws `Unreadable` for a
 *  reply that cannot be read, and passes on any other error, which is a
 *  request with no reply. */
export async function paragraphFindings(
  pass: Pass,
  settings: JevSettings,
  paragraph: string,
  place: Place,
  ask: Ask,
): Promise<NewFinding[] | null> {
  const rule = pass.prompt;
  const sentences = sentencesOf(paragraph);
  if (sentences.length === 0) return [];

  const detect = await ask(paragraph, detectQuestions(rule, paragraph, sentences));
  if (detect === null) return STOPPED;
  const probabilities = readNouls(detect, sentences.length);

  let stopped = false;
  const perSentence = await Promise.all(
    sentences.map(async (sentence, i): Promise<NewFinding[]> => {
      const p = probabilities[i]!;
      if (p < settings.keep) return [];
      const words = wordsOf(sentence.text);
      if (words.length === 0) return [];
      const all = spansOf(words.length);
      const chosen: WordSpan[] = [];
      const quotes: string[] = [];
      const found: NewFinding[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        const open = withoutOverlaps(all, chosen);
        if (open.length === 0) break;
        const options = optionsOf(sentence.text, words, open);
        const question = locateQuestion(rule, sentence.text, options, quotes);
        const reply = await ask(paragraph, { quote: question });
        if (reply === null) {
          stopped = true;
          break;
        }
        const pick = readChoice(reply, "quote", question.criteria);
        if (pick === NONE) break;
        const span = open.find((s) => optionKey(s) === pick)!;
        chosen.push(span);
        quotes.push(options[pick]!);
        const from = sentence.from + words[span[0]]!.from;
        const to = sentence.from + words[span[1]]!.to;
        found.push({
          category: pass.category,
          severity: severity(p),
          note: settings.note,
          ...quoteAt(place.points, place.start, paragraph, from, to),
        });
      }
      return found;
    }),
  );
  return stopped ? STOPPED : perSentence.flat();
}

/** One paragraph a Jev pass asks about, with the key of its answer. */
export interface Asked {
  key: string;
  paragraph: string;
  place: Place;
}

/** How the paragraphs of one Jev pass ended. */
export interface Answered {
  /** Paragraphs whose reply could not be read. */
  unreadable: number;
  /** Paragraphs with a request that got no reply. */
  unanswered: number;
  /** Why the pass failed, or null. */
  failure: string | null;
}

/** Ask about each paragraph and save each answer (SPEC §8.4). A paragraph
 *  whose reply cannot be read, or whose request gets no reply, fails alone
 *  (`Failures`). Its answer is not saved, so the next run asks it again. The
 *  pass fails when every paragraph failed, or when `save` fails. `note`
 *  receives the message of each paragraph that failed. */
export async function answerParagraphs(
  pass: Pass,
  settings: JevSettings,
  asked: Asked[],
  ask: Ask,
  save: (key: string, found: NewFinding[]) => Promise<void>,
  note: (message: string) => void,
): Promise<Answered> {
  const failures = new Failures(note);
  await Promise.all(
    asked.map(async ({ key, paragraph, place }) => {
      let found: NewFinding[] | null;
      try {
        found = await paragraphFindings(pass, settings, paragraph, place, ask);
      } catch (e) {
        failures.call(e);
        return;
      }
      if (found === STOPPED) return;
      try {
        await save(key, found);
      } catch (e) {
        failures.fail(e);
      }
    }),
  );
  const failure = failures.settle(asked.length);
  return { unreadable: failures.unreadable, unanswered: failures.unanswered, failure };
}
