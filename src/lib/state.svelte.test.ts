import { test, expect } from "bun:test";

// bun runs this file without the Svelte compiler, so the runes are not
// defined. The store only needs them to hold plain values for these tests.
const g = globalThis as Record<string, unknown>;
g.$state = <T>(v: T) => v;
g.$derived = Object.assign(<T>(v: T) => v, { by: <T>(f: () => T) => f });

const { nextCursor } = await import("./state.svelte");

test("stepping wraps at both ends", () => {
  expect(nextCursor(0, 1, 4)).toBe(1);
  expect(nextCursor(3, 1, 4)).toBe(0);
  expect(nextCursor(0, -1, 4)).toBe(3);
});

test("stepping forward from nothing focused lands on the first", () => {
  expect(nextCursor(-1, 1, 4)).toBe(0);
  expect(nextCursor(-1, -1, 4)).toBe(2);
});

test("stepping an empty list focuses nothing", () => {
  expect(nextCursor(-1, 1, 0)).toBe(-1);
  expect(nextCursor(2, 1, 0)).toBe(-1);
});
