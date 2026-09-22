import { describe, expect, test } from "bun:test";
import { dollars, label, NONE, total, UNREPORTED, type Call } from "./usage";

const call = (input: number, output: number, costUsd: number | null): Call => ({
  tokens: { input, output, cacheRead: 0, cacheWrite: 0 },
  costUsd,
});

describe("total", () => {
  test("adds up priced calls", () => {
    expect(total([call(1000, 100, 0.01), call(2000, 200, 0.02)])).toEqual({
      inputTokens: 3000,
      outputTokens: 300,
      costUsd: 0.03,
    });
  });

  test("a run with one unpriced call has no cost, but keeps its tokens", () => {
    expect(total([call(1000, 100, 0.01), call(500, 50, null)])).toEqual({
      inputTokens: 1500,
      outputTokens: 150,
      costUsd: null,
    });
  });

  test("calls that reported nothing are left out, not counted as zero", () => {
    expect(total([UNREPORTED, call(10, 5, 0.001)])).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    });
  });

  test("a run where nothing was reported records nothing", () => {
    expect(total([UNREPORTED, UNREPORTED])).toEqual(NONE);
    expect(total([])).toEqual(NONE);
  });
});

describe("dollars", () => {
  test("keeps small costs visible", () => {
    expect(dollars(0)).toBe("$0");
    expect(dollars(0.00036)).toBe("$0.0004");
    expect(dollars(0.042)).toBe("$0.042");
    expect(dollars(3.5)).toBe("$3.50");
  });
});

describe("label", () => {
  test("every call priced: money only", () => {
    expect(label({ costUsd: 0.042, pricedCalls: 3, unpricedTokens: 0 })).toBe("$0.042");
  });

  test("no call priced: tokens only", () => {
    expect(label({ costUsd: 0, pricedCalls: 0, unpricedTokens: 18400 })).toBe("18,400 tokens");
  });

  test("some of each: says what the money leaves out", () => {
    expect(label({ costUsd: 0.042, pricedCalls: 2, unpricedTokens: 3100 })).toBe(
      "$0.042 · 3,100 tokens unpriced",
    );
  });

  test("nothing recorded: no label", () => {
    expect(label({ costUsd: 0, pricedCalls: 0, unpricedTokens: 0 })).toBeNull();
  });
});
