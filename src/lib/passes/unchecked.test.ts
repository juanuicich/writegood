import { describe, expect, test } from "bun:test";

// bun runs this file without the Svelte compiler, so the runes are not
// defined. The module only imports the store; these tests do not use it.
const g = globalThis as Record<string, unknown>;
g.$state = <T>(v: T) => v;
g.$derived = Object.assign(<T>(v: T) => v, { by: <T>(f: () => T) => f });

const { unchecked } = await import("./unchecked");

const check = (keys: string[], saved: string[]) => ({ keys, saved: new Set(saved) });

describe("unchecked paragraphs", () => {
  test("a paragraph is unchecked when one pass has no answer for it", () => {
    const a = check(["a0", "a1", "a2"], ["a0", "a1", "a2"]);
    const b = check(["b0", "b1", "b2"], ["b0", "b2"]);
    expect(unchecked([a, b])).toEqual([1]);
  });

  test("a paragraph every pass has answered is checked", () => {
    expect(unchecked([check(["a0", "a1"], ["a0", "a1"])])).toEqual([]);
  });

  test("an old answer does not check a changed paragraph", () => {
    // After an edit, paragraph 1 and the one after it have new keys.
    expect(unchecked([check(["a0", "a1'", "a2'", "a3"], ["a0", "a1", "a2", "a3"])])).toEqual([1, 2]);
  });

  test("before the first run there are no markers", () => {
    expect(unchecked([check(["a0", "a1"], []), check(["b0", "b1"], [])])).toBeNull();
  });

  test("one pass with answers is enough to count as run", () => {
    expect(unchecked([check(["a0", "a1"], ["a0"]), check(["b0", "b1"], [])])).toEqual([0, 1]);
  });

  test("with no paragraph pass there is nothing to mark", () => {
    expect(unchecked([])).toEqual([]);
  });
});
