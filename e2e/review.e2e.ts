/** Review in the real window (SPEC §16.2): a run puts one note in the margin
 *  per finding, each highlight covers its quoted words exactly, the keyboard
 *  moves the focus, the margin keeps the focused note in view, and the status
 *  bar shows what the run cost. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { dollars } from "../src/lib/usage";
import { command, COST_PER_CALL, e2e, FINDINGS, launch, statusText, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
  await command(app.browser, "run all passes");
  // The run is over when the progress line is gone and every note is placed.
  await until(app, "the run to finish", async () => {
    const running = await app.browser.execute(() => !!document.querySelector("footer .right .live"));
    const placed = await app.browser.execute(() => document.querySelectorAll(".margin .note").length);
    return !running && placed === FINDINGS.length;
  }, 30_000);
}, 90_000);
afterAll(() => app?.close());

interface Note {
  id: string;
  category: string;
  highlight: string;
}

/** Every note in the margin, with the text its highlight covers. A highlight
 *  can be split across several spans, so the spans are joined. */
const notes = () =>
  app.browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".margin .note")].map((n) => ({
      id: n.dataset.note!,
      category: n.querySelector(".cat")?.textContent ?? "",
      highlight: [...document.querySelectorAll(`.ProseMirror [data-finding="${n.dataset.note}"]`)]
        .map((s) => s.textContent)
        .join(""),
    })),
  ) as Promise<Note[]>;

const current = () =>
  app.browser.execute(() => ({
    note: document.querySelector<HTMLElement>(".margin .note.current")?.dataset.note ?? null,
    highlight: document.querySelector<HTMLElement>(".ProseMirror .finding-current")?.dataset.finding ?? null,
  }));

e2e("one note per finding, in document order", async () => {
  const found = await notes();
  expect(found.map((n) => n.category)).toEqual(FINDINGS.map((f) => f.category));
}, () => app);

e2e("each highlight covers exactly its quoted words", async () => {
  const found = await notes();
  for (const f of FINDINGS) {
    const note = found.find((n) => n.category === f.category);
    expect(note?.highlight).toBe(f.quote);
  }
}, () => app);

e2e("the status bar shows what the run cost", async () => {
  // One call per paragraph for the paragraph passes, one for each document
  // pass. The fake model saw every one of them.
  expect(app.model.calls.length).toBeGreaterThan(FINDINGS.length);
  const spent = await app.browser.$("footer .spent").getText();
  expect(spent).toBe(dollars(app.model.calls.length * COST_PER_CALL));
}, () => app);

e2e("Esc then j and k move the focus, in the margin and in the text", async () => {
  const { browser } = app;
  const ids = (await notes()).map((n) => n.id);

  await browser.keys([Key.Escape]);
  await until(app, "review mode", async () => (await statusText(browser)).startsWith("review"));
  expect(await current()).toEqual({ note: ids[0]!, highlight: ids[0]! });

  await browser.keys(["j"]);
  expect(await current()).toEqual({ note: ids[1]!, highlight: ids[1]! });

  await browser.keys(["k"]);
  expect(await current()).toEqual({ note: ids[0]!, highlight: ids[0]! });
}, () => app);

e2e("the focused note and its words are in view, far down the draft", async () => {
  const { browser } = app;
  const last = (await notes()).at(-1)!;
  await browser.keys(["j", "j", "j"]);
  await until(app, "the last note to take the focus", async () => (await current()).note === last.id);

  // The margin scrolls to follow the text; give it the frames it animates over.
  await until(app, "the last note and its highlight to be in view", async () => {
    const seen = await browser.execute((id: string) => {
      const inside = (el: Element | null, box: DOMRect) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      };
      const band = document.querySelector(".margin .band")!.getBoundingClientRect();
      const page = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      return {
        note: inside(document.querySelector(`.margin [data-note="${id}"]`), band),
        words: inside(document.querySelector(`.ProseMirror [data-finding="${id}"]`), page),
      };
    }, last.id);
    return seen.note && seen.words;
  }, 5_000);
}, () => app);

e2e("x marks the focused finding addressed", async () => {
  const { browser } = app;
  const { note } = await current();
  await browser.keys(["x"]);
  await until(app, "the note to read done", async () =>
    browser.execute(
      (id: string) => document.querySelector(`.margin [data-note="${id}"] .tag`)?.textContent === "done",
      note!,
    ),
  );
}, () => app);
