import { describe, expect, test } from "bun:test";
import type { JevReply, Pass, Provider } from "../ipc";
import { paragraphs, paragraphStarts } from "./parse";
import { CallError, Failures } from "./failures";
import { limiter } from "./limit";
import {
  answerParagraphs,
  cannotRun,
  DEFAULT_KEEP,
  detectQuestions,
  jevSettings,
  locateQuestion,
  MAX_OPTIONS,
  NONE,
  optionsOf,
  paragraphFindings,
  quoteAt,
  readChoice,
  readNouls,
  ROUNDS,
  sentencesOf,
  severity,
  spansOf,
  TEXT,
  Unreadable,
  withoutOverlaps,
  wordsOf,
  type Ask,
  type ChoiceQuestion,
  type NoulQuestion,
} from "./jev";

const RULE = "Find words that add emphasis and no meaning. Quote only the word.";

const pass = (over: Partial<Pass> = {}): Pass => ({
  slug: "filler-words",
  name: "Filler words",
  category: "filler-words",
  scope: "paragraph",
  enabled: true,
  prompt: RULE,
  path: "/passes/04-filler-words.md",
  jev: { method: "sentence", keep: 0.5, note: "Adds emphasis and no meaning." },
  ...over,
});

const provider = (over: Partial<Provider> = {}): Provider => ({
  kind: "jev",
  model: "jev-1.13.0",
  args: [],
  timeoutSecs: 60,
  ...over,
});

const reply = (answers: unknown, unreadable: string | null = null): JevReply => ({
  answers,
  tokens: { input: 100, output: 5, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0.0000042,
  model: "jev-1.13.0",
  unreadable,
});

const texts = (spans: { text: string }[]) => spans.map((s) => s.text);

describe("segmenting", () => {
  test("sentences of an English paragraph, without the space between them", () => {
    const p = "It was very late. We left.  Nobody asked why!";
    const s = sentencesOf(p);
    expect(texts(s)).toEqual(["It was very late.", "We left.", "Nobody asked why!"]);
    for (const x of s) expect(p.slice(x.from, x.to)).toBe(x.text);
  });

  test("sentences and words of a Spanish paragraph", () => {
    const p = "¿Dónde está? Es muy, muy bueno. Realmente lo es.";
    expect(texts(sentencesOf(p))).toEqual(["¿Dónde está?", "Es muy, muy bueno.", "Realmente lo es."]);
    expect(texts(wordsOf("Es muy, muy bueno."))).toEqual(["Es", "muy", "muy", "bueno"]);
  });

  test("sentences and words of a Japanese paragraph, which has no spaces", () => {
    const p = "東京は大きい都市です。本当にとても静かです。";
    expect(texts(sentencesOf(p))).toEqual(["東京は大きい都市です。", "本当にとても静かです。"]);
    const words = wordsOf("本当にとても静かです。");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect("本当にとても静かです。".slice(w.from, w.to)).toBe(w.text);
    expect(words.map((w) => w.text).join("")).toBe("本当にとても静かです");
  });

  test("words leave out spaces and punctuation", () => {
    expect(texts(wordsOf("Well — it's, frankly, fine."))).toEqual(["Well", "it's", "frankly", "fine"]);
  });

  test("a paragraph of only punctuation has no sentences with words", () => {
    expect(wordsOf("— … —")).toEqual([]);
  });
});

describe("listing spans", () => {
  test("every span of one to eight words", () => {
    expect(spansOf(3)).toEqual([[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]]);
    expect(spansOf(10).every(([a, b]) => b - a < 8)).toBe(true);
    expect(spansOf(10)).toHaveLength(10 * 8 - (7 * 8) / 2);
  });

  test("a long sentence drops the longest lengths until the list fits", () => {
    const spans = spansOf(40);
    expect(spans.length).toBeLessThanOrEqual(MAX_OPTIONS);
    const longest = Math.max(...spans.map(([a, b]) => b - a + 1));
    expect(longest).toBe(6);
    // Every span of that length or shorter is kept.
    expect(spans).toHaveLength(40 * 6 - (5 * 6) / 2);
  });

  test("a sentence longer than the limit keeps its first single words", () => {
    const spans = spansOf(300);
    expect(spans).toHaveLength(MAX_OPTIONS);
    expect(spans.every(([a, b]) => a === b)).toBe(true);
    expect(spans[0]).toEqual([0, 0]);
  });

  test("overlap removal keeps only spans that share no word with a chosen one", () => {
    const all = spansOf(4, 2);
    expect(withoutOverlaps(all, [[1, 2]])).toEqual([[0, 0], [3, 3]]);
    expect(withoutOverlaps(all, [])).toEqual(all);
  });

  test("an option is described by the exact text of its span", () => {
    const sentence = "It was, frankly, very late.";
    const words = wordsOf(sentence);
    const options = optionsOf(sentence, words, [[2, 2], [2, 3], [3, 4]]);
    expect(options).toEqual({ "2-2": "frankly", "2-3": "frankly, very", "3-4": "very late" });
  });
});

describe("questions", () => {
  test("detect carries the rule text word for word, the paragraph and each sentence", () => {
    const paragraph = "It was very late. We left.";
    const q = detectQuestions(RULE, paragraph, sentencesOf(paragraph));
    expect(Object.keys(q)).toEqual(["s0", "s1"]);
    expect(q.s1!).toEqual({
      type: "noul",
      instructions: { rule: RULE, paragraph, sentence: "We left.", question: TEXT.detect },
      criteria: { true: TEXT.detectTrue, false: TEXT.detectFalse },
    });
  });

  test("the first locate round offers the spans alone", () => {
    const q = locateQuestion(RULE, "It was very late.", { "2-2": "very" }, []);
    expect(q.criteria).toEqual({ "2-2": "very" });
    expect(q.instructions).toEqual({ rule: RULE, sentence: "It was very late.", question: TEXT.locate });
  });

  test("a later round names the quotes already chosen and offers none", () => {
    const q = locateQuestion(RULE, "It was very, very late.", { "3-3": "very" }, ["very"]);
    expect(q.criteria).toEqual({ "3-3": "very", [NONE]: TEXT.none });
    expect(q.instructions.already_quoted).toEqual(["very"]);
    expect(q.instructions.question).toBe(TEXT.locate + TEXT.locateMore);
  });
});

describe("reading answers", () => {
  test("Noul probabilities come back in sentence order", () => {
    const r = reply({ s1: { type: "noul", noul: 0.2 }, s0: { type: "noul", noul: 0.9 } });
    expect(readNouls(r, 2)).toEqual([0.9, 0.2]);
  });

  test("a missing, mistyped or out-of-range Noul is unreadable", () => {
    expect(() => readNouls(reply({ s0: { type: "noul", noul: 0.9 } }), 2)).toThrow(Unreadable);
    expect(() => readNouls(reply({ s0: { type: "choice", choice: "a" } }), 1)).toThrow(Unreadable);
    expect(() => readNouls(reply({ s0: { type: "noul", noul: 1.5 } }), 1)).toThrow(Unreadable);
    expect(() => readNouls(reply(null, "jev returned a body that is not JSON"), 1)).toThrow("not JSON");
    expect(() => readNouls(reply([1, 2]), 1)).toThrow(Unreadable);
  });

  test("a Choice must pick one of the options it was given", () => {
    const options = { "0-0": "very", [NONE]: TEXT.none };
    expect(readChoice(reply({ quote: { type: "choice", choice: "0-0" } }), "quote", options)).toBe("0-0");
    expect(readChoice(reply({ quote: { type: "choice", choice: NONE } }), "quote", options)).toBe(NONE);
    expect(() => readChoice(reply({ quote: { type: "choice", choice: "9-9" } }), "quote", options)).toThrow(Unreadable);
    expect(() => readChoice(reply({ quote: { type: "choice", choice: NONE } }), "quote", { "0-0": "very" })).toThrow(
      Unreadable,
    );
    expect(() => readChoice(reply({ quote: { type: "noul", noul: 1 } }), "quote", options)).toThrow(Unreadable);
    expect(() => readChoice(reply({}), "quote", options)).toThrow(Unreadable);
  });
});

describe("severity", () => {
  test("bands of the Noul probability", () => {
    expect(severity(0.85)).toBe("high");
    expect(severity(0.99)).toBe("high");
    expect(severity(0.8499)).toBe("medium");
    expect(severity(0.65)).toBe("medium");
    expect(severity(0.6499)).toBe("low");
    expect(severity(0.45)).toBe("low");
  });
});

describe("quotes", () => {
  test("the quote, prefix and suffix are cut from the draft by scalar value", () => {
    // The emoji is one scalar value and two UTF-16 code units.
    const draft = "🙂 Una nota.\n\nEs muy, muy bueno. Realmente lo es y nada más que eso, de verdad.";
    const paras = paragraphs(draft);
    const starts = paragraphStarts(draft);
    const paragraph = paras[1]!;
    const from = paragraph.indexOf("Realmente");
    const got = quoteAt(Array.from(draft), starts[1]!, paragraph, from, from + "Realmente".length);
    expect(got.quote).toBe("Realmente");
    expect(got.prefix).toBe("🙂 Una nota.\n\nEs muy, muy bueno. ");
    expect(Array.from(got.prefix)).toHaveLength(32);
    expect(got.suffix).toBe(" lo es y nada más que eso, de ve");
    expect(Array.from(got.suffix)).toHaveLength(32);
  });

  test("a quote at the very start of the draft has an empty prefix", () => {
    const draft = "Very late.";
    const got = quoteAt(Array.from(draft), 0, draft, 0, 4);
    expect(got).toEqual({ quote: "Very", prefix: "", suffix: " late." });
  });
});

describe("settings", () => {
  test("the pass's keep wins over the provider's, which wins over 0.45", () => {
    expect(jevSettings(pass(), provider({ keep: 0.6 })).keep).toBe(0.5);
    expect(jevSettings(pass({ jev: {} }), provider({ keep: 0.6 })).keep).toBe(0.6);
    expect(jevSettings(pass({ jev: {} }), provider()).keep).toBe(DEFAULT_KEEP);
  });

  test("the method defaults to sentence and the note to the pass's name", () => {
    const s = jevSettings(pass({ jev: null }), provider());
    expect(s).toEqual({ method: "sentence", keep: DEFAULT_KEEP, note: "Filler words" });
  });

  test("an unknown method or a keep outside 0 to 1 is refused", () => {
    expect(() => jevSettings(pass({ jev: { method: "paragraph" } }), provider())).toThrow("paragraph");
    expect(() => jevSettings(pass({ jev: { keep: 45 } }), provider())).toThrow("between 0 and 1");
  });

  test("document scope and method across cannot run", () => {
    const doc = pass({ scope: "document" });
    expect(cannotRun(doc, jevSettings(doc, provider()))).toContain("scope");
    const across = pass({ jev: { method: "across" } });
    expect(cannotRun(across, jevSettings(across, provider()))).toContain("not built");
    expect(cannotRun(pass(), jevSettings(pass(), provider()))).toBeNull();
  });
});

// -------------------------------------------------------------- the method

type Questions = Record<string, NoulQuestion | ChoiceQuestion>;

/** A fake Jev. `nouls` gives each sentence's probability by its text; each
 *  Choice picks the first option whose text is in `pick`, else `none`, else
 *  the first option. */
function fakeJev(nouls: Record<string, number>, pick: string[]) {
  const seen: { state: string; questions: Questions }[] = [];
  const ask: Ask = async (state, questions) => {
    seen.push({ state, questions });
    const answers: Record<string, unknown> = {};
    for (const [key, q] of Object.entries(questions)) {
      if (q.type === "noul") {
        answers[key] = { type: "noul", noul: nouls[q.instructions.sentence as string] ?? 0 };
      } else {
        const entries = Object.entries(q.criteria);
        const hit = entries.find(([k, text]) => k !== NONE && pick.includes(text));
        const choice = hit?.[0] ?? (NONE in q.criteria ? NONE : entries[0]![0]);
        answers[key] = { type: "choice", choice, probabilities: {}, confidence: 1 };
      }
    }
    return reply(answers);
  };
  return { ask, seen };
}

const DRAFT = "# Title\n\nIt was very, very late. We left. Clearly nobody minded.";
const PARA = paragraphs(DRAFT)[1]!;
const PLACE = { points: Array.from(DRAFT), start: paragraphStarts(DRAFT)[1]! };

describe("method sentence", () => {
  test("keeps sentences at or above the threshold and quotes the chosen spans", async () => {
    const jev = fakeJev({ "It was very, very late.": 0.9, "We left.": 0.49, "Clearly nobody minded.": 0.5 }, [
      "very",
      "Clearly",
    ]);
    const found = await paragraphFindings(pass(), jevSettings(pass(), provider()), PARA, PLACE, jev.ask);
    expect(found).toEqual([
      {
        category: "filler-words",
        severity: "high",
        note: "Adds emphasis and no meaning.",
        quote: "very",
        prefix: "# Title\n\nIt was ",
        suffix: ", very late. We left. Clearly no",
      },
      {
        category: "filler-words",
        severity: "high",
        note: "Adds emphasis and no meaning.",
        quote: "very",
        prefix: "# Title\n\nIt was very, ",
        suffix: " late. We left. Clearly nobody m",
      },
      {
        category: "filler-words",
        severity: "low",
        note: "Adds emphasis and no meaning.",
        quote: "Clearly",
        prefix: "t was very, very late. We left. ",
        suffix: " nobody minded.",
      },
    ]);
    // Every request's state is the paragraph alone.
    expect(jev.seen.every((s) => s.state === PARA)).toBe(true);
  });

  test("a later round leaves out the spans that overlap a chosen quote", async () => {
    const jev = fakeJev({ "It was very, very late.": 0.9 }, ["very"]);
    await paragraphFindings(pass(), jevSettings(pass(), provider()), PARA, PLACE, jev.ask);
    const rounds = jev.seen.filter((s) => "quote" in s.questions).map((s) => s.questions.quote as ChoiceQuestion);
    // Round 1 picks the first "very", round 2 the second, round 3 answers none.
    expect(rounds).toHaveLength(3);
    expect(Object.keys(rounds[0]!.criteria)).toContain("2-2");
    expect(Object.keys(rounds[1]!.criteria)).not.toContain("2-2");
    expect(Object.keys(rounds[1]!.criteria)).not.toContain("1-2");
    expect(rounds[1]!.criteria[NONE]).toBe(TEXT.none);
    expect(rounds[2]!.instructions.already_quoted).toEqual(["very", "very"]);
  });

  test("a sentence stops after four rounds", async () => {
    const jev = fakeJev({ "One two three four five six.": 1 }, []);
    const para = "One two three four five six.";
    const found = await paragraphFindings(pass(), jevSettings(pass(), provider()), para, { points: Array.from(para), start: 0 }, async (s, q) => {
      // Pick the first option every time; `none` is never chosen.
      if ("quote" in q) {
        const c = (q.quote as ChoiceQuestion).criteria;
        const first = Object.keys(c).find((k) => k !== NONE)!;
        return reply({ quote: { type: "choice", choice: first } });
      }
      return jev.ask(s, q);
    });
    expect(found).toHaveLength(ROUNDS);
  });

  test("no sentence kept means one request and no findings", async () => {
    const jev = fakeJev({}, []);
    const found = await paragraphFindings(pass(), jevSettings(pass(), provider()), PARA, PLACE, jev.ask);
    expect(found).toEqual([]);
    expect(jev.seen).toHaveLength(1);
    expect(Object.keys(jev.seen[0]!.questions)).toEqual(["s0", "s1", "s2"]);
  });

  test("a Choice outside the options makes the paragraph unreadable", async () => {
    const ask: Ask = async (_, q) =>
      "quote" in q ? reply({ quote: { type: "choice", choice: "made-up" } }) : reply({ s0: { type: "noul", noul: 1 } });
    const para = "It was very late.";
    await expect(
      paragraphFindings(pass(), jevSettings(pass(), provider()), para, { points: Array.from(para), start: 0 }, ask),
    ).rejects.toBeInstanceOf(Unreadable);
  });

  test("a stopped pass saves nothing for the paragraph", async () => {
    const ask: Ask = async (_, q) => ("quote" in q ? null : reply({ s0: { type: "noul", noul: 1 } }));
    const para = "It was very late.";
    const found = await paragraphFindings(
      pass(),
      jevSettings(pass(), provider()),
      para,
      { points: Array.from(para), start: 0 },
      ask,
    );
    expect(found).toBeNull();
  });

  test("a request with no reply fails, and the error passes on", async () => {
    const ask: Ask = async () => {
      throw new Error("jev: HTTP 401 Unauthorized");
    };
    await expect(paragraphFindings(pass(), jevSettings(pass(), provider()), PARA, PLACE, ask)).rejects.toThrow("401");
  });
});

describe("answering paragraphs", () => {
  const PARAS = ["It was very late.", "We left early.", "Nobody minded."];
  const asked = PARAS.map((paragraph, i) => ({ key: `k${i}`, paragraph, place: { points: Array.from(paragraph), start: 0 } }));

  /** No sentence is kept, except that a request whose state is in `fail`
   *  throws and one in `garble` is unreadable. */
  const jevWith = (fail: string[], garble: string[] = []): Ask => async (state, q) => {
    if (fail.includes(state)) throw new Error("jev: HTTP 503 Service Unavailable");
    if (garble.includes(state)) return reply(null, "jev returned a body that is not JSON");
    return reply(Object.fromEntries(Object.keys(q).map((k) => [k, { type: "noul", noul: 0 }])));
  };

  const run = async (ask: Ask, save = async (_key: string) => {}) => {
    const saved: string[] = [];
    const notes: string[] = [];
    const result = await answerParagraphs(
      pass(),
      jevSettings(pass(), provider()),
      asked,
      ask,
      async (key) => {
        await save(key);
        saved.push(key);
      },
      new Failures((m) => notes.push(m)),
    );
    return { ...result, saved: saved.sort(), notes };
  };

  test("a request with no reply fails only its paragraph, which is not saved", async () => {
    const r = await run(jevWith([PARAS[1]!]));
    expect(r.failure).toBeNull();
    expect(r.unanswered).toBe(1);
    expect(r.unreadable).toBe(0);
    expect(r.saved).toEqual(["k0", "k2"]);
    expect(r.notes).toEqual(["jev: HTTP 503 Service Unavailable"]);
  });

  test("an unreadable reply fails only its paragraph, which is not saved", async () => {
    const r = await run(jevWith([], [PARAS[0]!]));
    expect(r.failure).toBeNull();
    expect(r.unreadable).toBe(1);
    expect(r.saved).toEqual(["k1", "k2"]);
  });

  test("the pass fails when every paragraph failed, either way", async () => {
    const r = await run(jevWith([PARAS[0]!, PARAS[2]!], [PARAS[1]!]));
    expect(r.unanswered).toBe(2);
    expect(r.unreadable).toBe(1);
    expect(r.saved).toEqual([]);
    expect(r.failure).not.toBeNull();
  });

  test("an answer that cannot be saved fails the pass", async () => {
    const r = await run(jevWith([]), async (key) => {
      if (key === "k1") throw new Error("database is locked");
    });
    expect(r.failure).toBe("database is locked");
    expect(r.saved).toEqual(["k0", "k2"]);
  });

  test("a refused key fails the pass, and no request starts after it", async () => {
    // One request at a time, as the run's limiter would allow. Each request
    // checks the failures first and marks a whole-pass failure before it
    // gives up its slot, as run.ts does.
    const limit = limiter(1);
    const failures = new Failures();
    let sent = 0;
    const ask: Ask = (_state, _q) =>
      limit(async () => {
        if (failures.stopped) return null;
        sent += 1;
        const e = new CallError("jev: HTTP 401 Unauthorized: bad key", true);
        failures.fail(e);
        throw e;
      });
    const saved: string[] = [];
    const r = await answerParagraphs(
      pass(),
      jevSettings(pass(), provider()),
      asked,
      ask,
      async (key) => void saved.push(key),
      failures,
    );
    expect(sent).toBe(1);
    expect(r.failure).toBe("jev: HTTP 401 Unauthorized: bad key");
    expect(r.unanswered).toBe(0);
    expect(saved).toEqual([]);
  });

  test("no paragraphs to ask is not a failure", async () => {
    const r = await answerParagraphs(pass(), jevSettings(pass(), provider()), [], jevWith([]), async () => {}, new Failures());
    expect(r).toEqual({ unreadable: 0, unanswered: 0, failure: null });
  });
});
