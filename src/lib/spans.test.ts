import { describe, expect, test } from "bun:test";
import { tidy, type Range } from "./spans";

/** The range that covers `quote`, found by its first occurrence. */
function at(text: string, quote: string): Range {
  const i = text.indexOf(quote);
  if (i < 0) throw new Error(`no ${quote}`);
  const from = Array.from(text.slice(0, i)).length;
  return { from, to: from + Array.from(quote).length };
}

/** The text each tidied range covers. */
function drawn(text: string, ranges: (Range | null)[]): (string | null)[] {
  const chars = Array.from(text);
  return tidy(text, ranges).map((r) => (r ? chars.slice(r.from, r.to).join("") : null));
}

const TEXT =
  "Very few of the members had actually read it. Unfortunately, the meeting was conducted in a manner that was really quite unproductive.";

describe("rule 1: edges", () => {
  test("a leading space is trimmed", () => {
    expect(drawn(TEXT, [at(TEXT, " Unfortunately")])).toEqual(["Unfortunately"]);
  });

  test("a leading comma and the space after it are trimmed", () => {
    expect(drawn(TEXT, [at(TEXT, ", the meeting")])).toEqual(["the meeting"]);
  });

  test("a trailing space is trimmed", () => {
    expect(drawn(TEXT, [at(TEXT, "really quite ")])).toEqual(["really quite"]);
  });

  test("a trailing full stop on its own is kept", () => {
    expect(drawn(TEXT, [at(TEXT, "quite unproductive.")])).toEqual(["quite unproductive."]);
  });

  test("a range that is all space or punctuation is drawn as placed", () => {
    expect(drawn(TEXT, [at(TEXT, ", ")])).toEqual([", "]);
  });
});

describe("rule 2: overlapping ends meet", () => {
  test("an end short of the full stop moves to meet one that takes it", () => {
    const text = "It is a feeling that recurs.";
    expect(drawn(text, [at(text, "a feeling that recurs"), at(text, "It is a feeling that recurs.")])).toEqual([
      "a feeling that recurs.",
      "It is a feeling that recurs.",
    ]);
  });

  test("a start inside an opening quote moves to meet one outside it", () => {
    const text = 'He said "it will be done" and left.';
    expect(drawn(text, [at(text, 'it will be done"'), at(text, '"it will')])).toEqual([
      '"it will be done"',
      '"it will',
    ]);
  });

  test("ends a word apart do not move", () => {
    expect(drawn(TEXT, [at(TEXT, "really quite"), at(TEXT, "quite unproductive.")])).toEqual([
      "really quite",
      "quite unproductive.",
    ]);
  });

  test("ranges that do not overlap do not move", () => {
    const text = "It is familiar. It is a feeling that recurs.";
    expect(drawn(text, [at(text, "It is familiar"), at(text, "a feeling that recurs.")])).toEqual([
      "It is familiar",
      "a feeling that recurs.",
    ]);
  });

  test("a move that brings an end level with a third range carries on", () => {
    const text = 'She wrote "done.")';
    // a reaches b's end over the stop; then b's end, now shared, reaches c's
    // over the quote and bracket.
    const a = at(text, "wrote");
    const r = [{ from: a.from, to: text.indexOf(".") }, at(text, 'wrote "done.'), at(text, 'She wrote "done.")')];
    expect(drawn(text, r)).toEqual(['wrote "done.")', 'wrote "done.")', 'She wrote "done.")']);
  });
});

describe("bookkeeping", () => {
  test("unplaced ranges stay null and keep their index", () => {
    expect(drawn(TEXT, [null, at(TEXT, " really"), null])).toEqual([null, "really", null]);
  });

  test("offsets are code points, not UTF-16 units", () => {
    const text = "😀 The chair spoke.";
    expect(drawn(text, [at(text, " The chair")])).toEqual(["The chair"]);
  });

  test("the input ranges are not changed", () => {
    const r = at(TEXT, " Unfortunately");
    const copy = { ...r };
    tidy(TEXT, [r]);
    expect(r).toEqual(copy);
  });
});
