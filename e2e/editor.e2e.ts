/** The editor in the real window (SPEC §16.2): the draft opens, typed text
 *  reaches ProseMirror, and a save writes it to the Markdown file. */
import { afterAll, beforeAll, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Key } from "webdriverio";
import { e2e, editorText, launch, TITLE, typeAtEnd, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
}, 60_000);
afterAll(() => app?.close());

const onDisk = () => readFileSync(join(app.home, "documents", "committee.md"), "utf8");

e2e("opens the draft", async () => {
  expect(await editorText(app.browser)).toContain(TITLE);
  expect(await app.browser.$(".ProseMirror h1").getText()).toBe(TITLE);
}, () => app);

e2e("typed text reaches the editor and a save writes it to disk", async () => {
  const { browser } = app;
  await typeAtEnd(browser, ".ProseMirror p", " Typed by a test.");
  expect(await browser.$(".ProseMirror p").getText()).toEndWith("unproductive. Typed by a test.");

  await browser.keys([Key.Command, "s"]);
  await until(app, "the file on disk to hold the typed text", async () => onDisk().includes("Typed by a test."));
  // Still Markdown, and the text landed where the caret was.
  expect(onDisk()).toStartWith(`# ${TITLE}\n`);
  expect(onDisk()).toContain("really quite unproductive. Typed by a test.\n");
}, () => app);

e2e("⌘Y opens the revisions and does not redo", async () => {
  const { browser } = app;
  await typeAtEnd(browser, ".ProseMirror p", " Undone by a test.");
  await browser.keys([Key.Command, "s"]);
  await until(app, "the save", async () => onDisk().includes("Undone by a test."));
  await browser.keys([Key.Command, "z"]);
  await until(app, "the undo", async () => !(await editorText(browser)).includes("Undone by a test."));

  await browser.keys([Key.Command, "y"]);
  await until(app, "the revisions sheet", async () => browser.execute(() => !!document.querySelector(".sheet .list")));
  expect(await editorText(browser)).not.toContain("Undone by a test.");
  await browser.keys([Key.Escape]);
}, () => app);
