import { describe, expect, test } from "bun:test";
import { MAX_SIZE, MIN_SIZE, nextSize, otherTheme } from "./appearance";

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

describe("otherTheme", () => {
  test("flips light and dark", () => {
    expect(otherTheme("light", true)).toBe("dark");
    expect(otherTheme("dark", false)).toBe("light");
  });

  test("system flips what the system shows", () => {
    expect(otherTheme("system", true)).toBe("light");
    expect(otherTheme("system", false)).toBe("dark");
  });
});
