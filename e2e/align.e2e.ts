/** Notes align with their highlights (SPEC §12.3). The caret moving into a
 *  highlight aligns its note and lights nothing. A step with j or k aligns
 *  the note too, and scrolls the draft only to bring the words into view and
 *  make room for the whole note. */
import { afterAll, beforeAll, expect } from "bun:test";
import { caretAtEnd, e2e, FINDINGS, launch, litInText, runPasses, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
  await runPasses(app);
}, 90_000);
afterAll(() => app?.close());

/** Note ids by category, from the margin. */
const ids = async () =>
  Object.fromEntries(
    (await app.browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".margin .note")].map((n) => [
        n.querySelector(".cat")?.textContent ?? "",
        n.dataset.note!,
      ]),
    )) as [string, string][],
  );

/** Where a note and its highlight sit, against the band and the draft. */
const layout = (id: string) =>
  app.browser.execute((id: string) => {
    const note = document.querySelector(`.margin [data-note="${id}"]`)!.getBoundingClientRect();
    const words = document.querySelector(`.ProseMirror .finding-id-${id}`)!.getBoundingClientRect();
    const band = document.querySelector(".margin .band")!.getBoundingClientRect();
    return {
      gap: note.top - words.top,
      page: document.querySelector(".page")!.scrollTop,
      wordsInBand: words.top >= band.top && words.bottom <= band.bottom,
      noteInBand: note.top >= band.top && note.bottom <= band.bottom,
      litNotes: document.querySelectorAll(".margin .note.current").length,
    };
  }, id);

const level = (id: string) => async () => Math.abs((await layout(id)).gap) < 2;

e2e("the caret moving into a highlight aligns its note, lights nothing and keeps the draft still", async () => {
  const id = (await ids()).passive!;
  // Four notes from the first paragraph stack above it, so it starts well
  // below its sentence.
  const before = await layout(id);
  expect(before.gap).toBeGreaterThan(20);

  await caretAtEnd(app.browser, `.ProseMirror .finding-id-${id}`);
  await until(app, "the note to sit level with its words", level(id), 5_000);
  const after = await layout(id);
  expect(after.page).toBe(before.page);
  expect(after.litNotes).toBe(0);
  expect(await litInText(app.browser)).toEqual([]);
}, () => app);

e2e("a caret outside every highlight leaves the margin where it is", async () => {
  const id = (await ids()).passive!;
  await caretAtEnd(app.browser, ".ProseMirror h1");
  await Bun.sleep(200);
  expect(Math.abs((await layout(id)).gap)).toBeLessThan(2);
}, () => app);

e2e("k to the last finding scrolls the draft to it and aligns the note", async () => {
  const id = (await ids()).repetition!;
  const before = await layout(id);
  expect(before.wordsInBand).toBe(false);

  await app.browser.keys(["Escape"]);
  // From no focus, k wraps to the last finding.
  await app.browser.keys(["k"]);
  await until(app, "the last note to sit level with its words", level(id), 5_000);
  const after = await layout(id);
  expect(after.page).toBeGreaterThan(before.page);
  expect(after.wordsInBand).toBe(true);
  expect(after.noteInBand).toBe(true);
}, () => app);

e2e("j from the last finding wraps to the first and scrolls back up", async () => {
  const byCat = await ids();
  const first = byCat[FINDINGS[0]!.category]!;
  await app.browser.keys(["j"]);
  await until(app, "the first note to sit level with its words", level(first), 5_000);
  const after = await layout(first);
  expect(after.wordsInBand).toBe(true);
  expect(after.noteInBand).toBe(true);
}, () => app);

e2e("j onto a stacked note in view aligns it", async () => {
  const id = (await ids()).passive!;
  // From the first finding, four steps reach "time had expired".
  await app.browser.keys(["j", "j", "j", "j"]);
  await until(app, "the stacked note to sit level with its words", level(id), 5_000);
  expect((await layout(id)).noteInBand).toBe(true);
}, () => app);

e2e("going back to writing unlights the focus, and the next j steps on from it", async () => {
  const byCat = await ids();
  // The last test left the focus on "time had expired", in review mode.
  await app.browser.keys(["i"]);
  await until(app, "nothing to be lit", async () => (await layout(byCat.passive!)).litNotes === 0, 5_000);
  expect(await litInText(app.browser)).toEqual([]);

  await app.browser.keys(["Escape"]);
  await until(app, "the kept focus to light again", async () => (await litInText(app.browser)).length === 1, 5_000);
  expect(await litInText(app.browser)).toEqual([byCat.passive!]);
  await app.browser.keys(["j"]);
  await until(app, "the next finding to light", async () => (await litInText(app.browser))[0] === byCat.repetition, 5_000);
}, () => app);
