import { describe, expect, test } from "bun:test";
import { MARGIN, MAX_CORE, MIN_CORE, SINGLE, windowOf, windows } from "./windows";

/** Paragraphs of a given length, each with distinct text. */
function paras(n: number, len = 900): string[] {
  return Array.from({ length: n }, (_, i) => `Paragraph ${i}. `.padEnd(len, "word "));
}

const join = (ps: string[]) => ps.join("\n\n");

describe("windows", () => {
  test("a short draft is one window holding the draft exactly", () => {
    const ps = ["One.", "Two."];
    const draft = "# One.\n\nTwo.\n";
    expect(windows(ps, draft)).toEqual([{ from: 0, to: 2, text: draft, excerpt: false }]);
  });

  test("a long draft's cores cover every paragraph once, in order", () => {
    const ps = paras(80);
    const ws = windows(ps, join(ps));
    expect(join(ps).length).toBeGreaterThan(SINGLE);
    expect(ws.length).toBeGreaterThan(1);
    expect(ws[0]!.from).toBe(0);
    expect(ws.at(-1)!.to).toBe(ps.length);
    for (let i = 1; i < ws.length; i++) expect(ws[i]!.from).toBe(ws[i - 1]!.to);
  });

  test("cores stay within their limits", () => {
    const ps = paras(80);
    const ws = windows(ps, join(ps));
    for (const w of ws) {
      const size = ps.slice(w.from, w.to).reduce((n, p) => n + p.length, 0);
      expect(size).toBeLessThanOrEqual(MAX_CORE);
      if (w !== ws.at(-1)) expect(size).toBeGreaterThanOrEqual(Math.min(MIN_CORE, MAX_CORE - 900));
    }
  });

  test("each window carries its margins as context, clipped at the ends", () => {
    const ps = paras(80);
    const ws = windows(ps, join(ps));
    const first = ws[0]!;
    expect(first.text.startsWith(ps[0]!)).toBe(true);
    expect(first.text.endsWith(ps[first.to + MARGIN - 1]!)).toBe(true);
    const second = ws[1]!;
    expect(second.text.startsWith(ps[second.from - MARGIN]!)).toBe(true);
    expect(ws.at(-1)!.text.endsWith(ps.at(-1)!)).toBe(true);
    expect(ws.every((w) => w.excerpt)).toBe(true);
  });

  test("an edit leaves the windows before it unchanged, and most after it", () => {
    const ps = paras(120);
    const before = windows(ps, join(ps));
    const edited = [...ps];
    edited[60] = edited[60]!.replace("Paragraph 60.", "Paragraph sixty, changed.");
    const after = windows(edited, join(edited));
    const texts = new Set(before.map((w) => w.text));
    const same = after.filter((w) => texts.has(w.text)).length;
    // Only the windows whose core or margins hold paragraph 60 may change.
    expect(after.length - same).toBeLessThanOrEqual(3);
    const cut = before.findIndex((w) => w.to + MARGIN > 60);
    expect(after.slice(0, cut).map((w) => w.text)).toEqual(before.slice(0, cut).map((w) => w.text));
  });

  test("a paragraph longer than a core is a core of its own", () => {
    const ps = [...paras(10), "x".repeat(MAX_CORE + 500), ...paras(10)];
    const ws = windows(ps, join(ps));
    const big = windowOf(ws, 10);
    expect([big.from, big.to]).toEqual([10, 11]);
  });

  test("windowOf finds the core that holds a paragraph", () => {
    const ps = paras(80);
    const ws = windows(ps, join(ps));
    for (let i = 0; i < ps.length; i++) {
      const w = windowOf(ws, i);
      expect(i >= w.from && i < w.to).toBe(true);
    }
  });
});
