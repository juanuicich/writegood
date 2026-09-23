/** Running the passes again, in the real window (SPEC §8.3, §12.1): a rerun
 *  replaces the findings of each pass it runs, so the margin holds one note
 *  per finding, not two. ⌃⌘S hides and shows the margin, and review mode
 *  shows a hidden margin again. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, FINDINGS, launch, runPasses, statusText, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
  await runPasses(app);
}, 90_000);
afterAll(() => app?.close());

const noteIds = () =>
  app.browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".margin .note")].map((n) => n.dataset.note!),
  ) as Promise<string[]>;

const marginShown = () => app.browser.execute(() => !!document.querySelector(".margin"));

const underlines = () =>
  app.browser.execute(() => document.querySelectorAll(".ProseMirror [data-finding]").length);

e2e("a second run replaces the first run's notes", async () => {
  const first = await noteIds();
  expect(first).toHaveLength(FINDINGS.length);

  await runPasses(app);
  const second = await noteIds();
  expect(second).toHaveLength(FINDINGS.length);
  expect(second.filter((id) => first.includes(id))).toEqual([]);
}, () => app);

e2e("⌃⌘S hides the margin and keeps the underlines", async () => {
  const before = await underlines();
  expect(before).toBeGreaterThan(0);
  await app.browser.keys([Key.Control, Key.Command, "s"]);
  await until(app, "the margin to hide", async () => !(await marginShown()));
  expect(await underlines()).toBe(before);
}, () => app);

e2e("⌃⌘S shows it again", async () => {
  await app.browser.keys([Key.Control, Key.Command, "s"]);
  await until(app, "the margin to show", marginShown);
}, () => app);

e2e("review mode shows a hidden margin", async () => {
  await app.browser.keys([Key.Control, Key.Command, "s"]);
  await until(app, "the margin to hide", async () => !(await marginShown()));
  await app.browser.keys([Key.Escape]);
  await until(app, "review mode", async () => (await statusText(app.browser)).startsWith("review"));
  await until(app, "the margin to show", marginShown);
}, () => app);
