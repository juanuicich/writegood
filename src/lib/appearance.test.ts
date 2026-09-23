import { describe, expect, test } from "bun:test";
import { MAX_SIZE, MIN_SIZE, nextSize } from "./appearance";

describe("nextSize", () => {
  test("steps 1px either way", () => {
    expect(nextSize(18, 1)).toBe(19);
    expect(nextSize(18, -1)).toBe(17);
  });

  test("stops at the ends", () => {
    expect(nextSize(MAX_SIZE, 1)).toBe(MAX_SIZE);
    expect(nextSize(MIN_SIZE, -1)).toBe(MIN_SIZE);
  });

  test("a size set outside the range by hand moves into it", () => {
    expect(nextSize(40, 1)).toBe(MAX_SIZE);
    expect(nextSize(8, -1)).toBe(MIN_SIZE);
  });
});
