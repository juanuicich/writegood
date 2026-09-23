/** Files in any folder (SPEC §6.3): ⌘N starts an untitled draft, the first
 *  ⌘S asks where through the save dialog, and Save As onto another
 *  document's file is refused. The dialogs answer from pick.txt. */
import { afterAll, beforeAll, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Key } from "webdriverio";
import { e2e, editorText, launch, pick, statusText, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
}, 60_000);
afterAll(() => app?.close());

const unsaved = () => app.browser.execute(() => !!document.querySelector("footer .unsaved"));
const recovery = () => readdirSync(join(app.home, "untitled"));

e2e("⌘N starts an empty untitled draft that autosaves to a recovery file", async () => {
  const { browser } = app;
  await browser.keys([Key.Command, "n"]);
  await until(app, "an empty editor", async () => (await editorText(browser)) === "");
  expect(await statusText(browser)).toContain("untitled");

  // With no heading, the saved draft takes its title from its file name.
  await browser.$(".ProseMirror").addValue("Written outside the documents folder.");
  expect(await editorText(browser)).toBe("Written outside the documents folder.");
  await until(app, "the recovery file", async () => recovery().length === 1);
  expect(await unsaved()).toBe(true);
}, () => app);

e2e("the first ⌘S writes where the save dialog says, with .md added", async () => {
  const dir = join(app.home, "elsewhere");
  mkdirSync(dir);
  pick(app, join(dir, "piece"));
  await app.browser.keys([Key.Command, "s"]);

  const file = join(dir, "piece.md");
  await until(app, "the chosen file", async () => existsSync(file));
  expect(readFileSync(file, "utf8")).toBe("Written outside the documents folder.\n");
  await until(app, "the recovery file to go", async () => recovery().length === 0);
  expect(await unsaved()).toBe(false);
}, () => app);

e2e("Save As onto another document's file is refused", async () => {
  const committee = join(app.home, "documents", "committee.md");
  const before = readFileSync(committee, "utf8");
  pick(app, committee);
  await app.browser.keys([Key.Command, Key.Shift, "s"]);
  await until(app, "the refusal", async () => (await statusText(app.browser)).includes("already open"));
  expect(readFileSync(committee, "utf8")).toBe(before);
}, () => app);

e2e("open recent lists both documents and reopens the first", async () => {
  const { browser } = app;
  await browser.keys([Key.Command, "k"]);
  await browser.keys("open recent".split(""));
  await browser.keys("Enter");
  const rows = await browser.execute(() =>
    Array.from(document.querySelectorAll(".bar li")).map((li) => li.textContent ?? ""),
  );
  expect(rows.some((r) => r.includes("piece"))).toBe(true);
  expect(rows.some((r) => r.includes("The Determination of the Committee"))).toBe(true);
  await browser.keys("committee".split(""));
  await browser.keys("Enter");
  await until(app, "the committee draft", async () =>
    (await editorText(browser)).includes("The Determination of the Committee"),
  );
}, () => app);
