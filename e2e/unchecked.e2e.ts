/** Markers for paragraphs that are not checked, in the real window (SPEC
 *  §12.4). Before the first run, review mode shows none and says so. After a
 *  run, every paragraph is checked. An edit leaves the edited paragraph and
 *  the one after it unchecked, because their saved answers no longer match.
 *  The markers show only in review mode. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, launch, runPasses, statusText, typeAtEnd, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
}, 90_000);
afterAll(() => app?.close());

/** The text of each marked block, in document order. */
const marked = () =>
  app.browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".ProseMirror .unchecked")].map((el) => el.textContent ?? ""),
  ) as Promise<string[]>;

const reviewing = async () => (await statusText(app.browser)).startsWith("review");

async function enterReview() {
  await app.browser.keys([Key.Escape]);
  await until(app, "review mode", reviewing);
}

async function leaveReview() {
  await app.browser.keys([Key.Escape]);
  await until(app, "writing mode", async () => !(await reviewing()));
}

e2e("before any run, review mode shows no markers and says so", async () => {
  await enterReview();
  await until(app, "the status line", async () => (await statusText(app.browser)).includes("no passes run yet"));
  expect(await marked()).toEqual([]);
  await leaveReview();
}, () => app);

e2e("after a run, no paragraph is marked", async () => {
  await runPasses(app);
  await enterReview();
  // The markers are computed after review mode starts. Give them time.
  await Bun.sleep(1000);
  expect(await marked()).toEqual([]);
  await leaveReview();
}, () => app);

e2e("an edit marks that paragraph and the one after it", async () => {
  // The fourth paragraph of the draft: "The subsequent session began late."
  await typeAtEnd(app.browser, ".ProseMirror p:nth-of-type(3)", " It began at ten.");
  await enterReview();
  await until(app, "two markers", async () => (await marked()).length === 2);
  expect(await marked()).toEqual([
    "The subsequent session began late. The secretary read the minutes of the previous meeting aloud, slowly, and nobody objected to any part of them. It began at ten.",
    "A member from the finance office asked whether the proposal had a budget. The chair said a budget would be prepared. Nobody asked who would prepare it.",
  ]);
}, () => app);

e2e("leaving review mode removes the markers", async () => {
  await leaveReview();
  await until(app, "no markers", async () => (await marked()).length === 0);
}, () => app);
