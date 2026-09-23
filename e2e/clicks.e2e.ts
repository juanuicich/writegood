/** A click on a highlight (SPEC §12.3): it lights every finding under the
 *  pointer, focuses the first in document order, and scrolls the margin until
 *  that note is level with the words. The draft does not move. */
import { afterAll, beforeAll, expect } from "bun:test";
import { clickPoint, e2e, launch, litInText, pointAt, runPasses, until, type App } from "./harness";

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

const lit = async () => ({
  notes: (
    await app.browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".margin .note.current")].map((n) => n.dataset.note!),
    )
  ).sort(),
  words: await litInText(app.browser),
});

/** How far the note's top sits below its highlight's top, and where the
 *  draft is scrolled. */
const gap = (id: string) =>
  app.browser.execute((id: string) => {
    const note = document.querySelector(`.margin [data-note="${id}"]`)!.getBoundingClientRect();
    const words = document.querySelector(`.ProseMirror .finding-id-${id}`)!.getBoundingClientRect();
    return { gap: note.top - words.top, page: document.querySelector(".page")!.scrollTop };
  }, id);

e2e("a click on overlapping highlights lights every finding under it", async () => {
  const byCat = await ids();
  // "really" sits inside three findings: tone, stacking and filler.
  const under = ["tone", "stacking", "filler"].map((c) => byCat[c]!).sort();
  // The first span of "really quite" is "really", which all three cover.
  await clickPoint(app.browser, await pointAt(app.browser, `.ProseMirror .finding-id-${byCat.filler}`));
  await until(app, "the three findings to light", async () => {
    const now = await lit();
    return now.notes.length === 3;
  });
  expect(await lit()).toEqual({ notes: under, words: under });
}, () => app);

e2e("the next j lights one finding again", async () => {
  await app.browser.keys(["Escape"]);
  await app.browser.keys(["j"]);
  const now = await lit();
  expect(now.notes).toHaveLength(1);
  expect(now.words).toEqual(now.notes);
}, () => app);

e2e("a click puts the note level with its words, and the draft stays put", async () => {
  const byCat = await ids();
  const id = byCat.passive!;
  // Four notes from the first paragraph stack above it, so it starts well
  // below its sentence.
  const point = await pointAt(app.browser, `.ProseMirror .finding-id-${id}`);
  const before = await gap(id);
  expect(before.gap).toBeGreaterThan(20);

  await clickPoint(app.browser, point);
  await until(app, "the note to sit level with its words", async () => Math.abs((await gap(id)).gap) < 2, 5_000);
  expect((await gap(id)).page).toBe(before.page);
}, () => app);
