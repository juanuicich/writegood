/** Running the passes again, in the real window (SPEC §8.3, §12.1). A rerun
 *  with no edits reuses every saved answer. "afresh" asks again and replaces
 *  the notes. An edit asks only about the changed paragraph and the one after
 *  it. ⌃⌘S hides and shows the margin, and review mode shows a hidden margin
 *  again. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, FINDINGS, launch, runPasses, statusText, typeAtEnd, until, type App } from "./harness";

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

const running = () => app.browser.execute(() => !!document.querySelector("footer .right .live"));

/** Run with ⌘R and wait until the status line reports reused answers. */
async function rerun() {
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "the rerun to finish", async () =>
    !(await running()) && (await statusText(app.browser)).includes("reused"),
  30_000);
}

e2e("a second run with no edits asks nothing and keeps the notes", async () => {
  const first = await noteIds();
  expect(first).toHaveLength(FINDINGS.length);
  const calls = app.model.calls.length;

  await rerun();
  expect(app.model.calls.length).toBe(calls);
  expect(await noteIds()).toEqual(first);
  expect(await statusText(app.browser)).toContain("no new findings");
}, () => app);

e2e("run all passes afresh asks again and replaces the notes", async () => {
  const { browser } = app;
  const first = await noteIds();
  const calls = app.model.calls.length;

  await browser.keys([Key.Command, "k"]);
  await until(app, "the palette", async () => browser.$(".bar input").isExisting());
  await browser.$(".bar input").addValue("afresh");
  await browser.keys([Key.Enter]);
  await until(app, "new notes", async () => {
    const ids = await noteIds();
    return !(await running()) && ids.length === FINDINGS.length && ids.every((id) => !first.includes(id));
  }, 30_000);
  expect(app.model.calls.length).toBeGreaterThan(calls);
}, () => app);

e2e("an edit asks only about that paragraph and the one after it", async () => {
  const calls = app.model.calls.length;
  // The fourth paragraph of the draft: "The subsequent session began late."
  await typeAtEnd(app.browser, ".ProseMirror p:nth-of-type(3)", " It began at ten.");
  await rerun();

  const asked = app.model.calls.slice(calls);
  const paragraph = asked.filter((c) => c.prompt.includes("--- examine only this paragraph ---"));
  const examined = new Set(paragraph.map((c) => c.prompt.split("--- examine only this paragraph ---\n")[1]!.split("\n")[0]));
  expect([...examined].sort()).toEqual([
    "A member from the finance office asked whether the proposal had a budget. The chair said a budget would be prepared. Nobody asked who would prepare it.",
    "The subsequent session began late. The secretary read the minutes of the previous meeting aloud, slowly, and nobody objected to any part of them. It began at ten.",
  ]);
  // Every document pass sees a changed draft and is asked again.
  expect(asked.length - paragraph.length).toBe(3);
  expect(await noteIds()).toHaveLength(FINDINGS.length);
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
