import { describe, expect, test } from "bun:test";
import { buildVerifyPrompt, parseVerdicts, tally } from "./verify";

describe("buildVerifyPrompt", () => {
  const out = buildVerifyPrompt("  Find buried verbs.  ", "The draft.", [
    { quote: "made a decision", note: "Buried verb." },
    { quote: 'the "word"', note: "Second." },
  ]);

  test("starts with the draft, so the votes share a cached prefix", () => {
    expect(out.startsWith("--- the draft ---\nThe draft.\n")).toBe(true);
  });

  test("numbers the candidates and quotes them as JSON strings", () => {
    expect(out).toContain('1. quote: "made a decision"');
    expect(out).toContain('2. quote: "the \\"word\\""');
  });

  test("carries the rule and asks for JSON keep flags", () => {
    expect(out).toContain("--- the rule ---\nFind buried verbs.\n");
    expect(out).toMatch(/json/i);
    expect(out).toContain('"keep"');
  });
});

describe("parseVerdicts", () => {
  test("reads an array of flags by id", () => {
    expect(parseVerdicts('[{"id": 2, "keep": true}, {"id": 1, "keep": false}]', 2)).toEqual([false, true]);
  });

  test("reads a fenced array after chatter", () => {
    const text = 'Checked.\n```json\n[{"id": 1, "keep": true}]\n```';
    expect(parseVerdicts(text, 1)).toEqual([true]);
  });

  test("reads a bare object, which verifiers send for one candidate", () => {
    expect(parseVerdicts('{"id": 1, "keep": true}', 1)).toEqual([true]);
  });

  test("drops candidates the reply does not mention", () => {
    expect(parseVerdicts('[{"id": 1, "keep": true}]', 3)).toEqual([true, false, false]);
  });

  test("ignores ids out of range and flags that are not booleans", () => {
    expect(parseVerdicts('[{"id": 9, "keep": true}, {"id": 1, "keep": "yes"}, {"id": 2, "keep": true}]', 2)).toEqual([
      false,
      true,
    ]);
  });

  test("returns null for a reply it cannot read", () => {
    expect(parseVerdicts("I agree with all of them.", 2)).toBeNull();
    expect(parseVerdicts('[{"id": 1, "keep": tru', 2)).toBeNull();
  });
});

describe("tally", () => {
  test("keeps a candidate that two of three keep", () => {
    const votes = [
      [true, true, false],
      [true, false, false],
      [false, true, true],
    ];
    expect(tally(votes, 3)).toEqual([true, true, false]);
  });

  test("lowers the bar to the votes that could be read", () => {
    expect(tally([[true, false], null, null], 2)).toEqual([true, false]);
  });

  test("keeps everything when no vote could be read", () => {
    expect(tally([null, null, null], 2)).toEqual([true, true]);
  });
});
