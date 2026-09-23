/** Text size in the real window (SPEC §12.1): ⌘+ and ⌘- change the body and
 *  the margin together, and the size is saved to config.toml. ⌘+ is sent as
 *  ⌘=, the key a US keyboard presses for it. */
import { afterAll, beforeAll, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Key } from "webdriverio";
import { caretAtEnd, e2e, FINDINGS, launch, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
  // Run the passes so the margin is on screen.
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "the notes", async () =>
    app.browser.execute(() => document.querySelectorAll(".margin .note").length).then((n) => n === FINDINGS.length),
  );
}, 90_000);
afterAll(() => app?.close());

const sizes = () =>
  app.browser.execute(() => ({
    body: parseFloat(getComputedStyle(document.querySelector(".ProseMirror")!).fontSize),
    margin: parseFloat(getComputedStyle(document.querySelector(".margin")!).fontSize),
  }));

const savedSize = () => {
  const m = readFileSync(join(app.home, "config.toml"), "utf8").match(/font_size\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
};

e2e("⌘+ makes the body and the margin bigger, and saves the size", async () => {
  const before = await sizes();
  await app.browser.keys([Key.Command, "="]);
  await until(app, "the text to grow", async () => (await sizes()).body === before.body + 1);
  const after = await sizes();
  expect(after.margin).toBeGreaterThan(before.margin);
  expect(after.margin / after.body).toBeCloseTo(before.margin / before.body, 2);
  await until(app, "config.toml to hold the new size", async () => savedSize() === after.body);
}, () => app);

e2e("⌘- makes them smaller again", async () => {
  const before = await sizes();
  await app.browser.keys([Key.Command, "-"]);
  await app.browser.keys([Key.Command, "-"]);
  await until(app, "the text to shrink", async () => (await sizes()).body === before.body - 2);
  expect((await sizes()).margin).toBeLessThan(before.margin);
  await until(app, "config.toml to hold the new size", async () => savedSize() === before.body - 2);
}, () => app);

e2e("a save keeps the comments in config.toml", async () => {
  expect(readFileSync(join(app.home, "config.toml"), "utf8")).toStartWith("# Written by the e2e harness.\n");
}, () => app);

e2e("⌘+ works while the duel covers the window", async () => {
  const { browser } = app;
  await caretAtEnd(browser, ".ProseMirror p");
  await browser.keys([Key.Command, "d"]);
  await until(app, "the duel sheet", async () => browser.$(".sheet textarea").isExisting());
  const before = await sizes();
  await browser.keys([Key.Command, "="]);
  await until(app, "the text to grow under the sheet", async () => (await sizes()).body === before.body + 1);
  await until(app, "config.toml to hold the new size", async () => savedSize() === before.body + 1);
  await browser.keys([Key.Escape]);
}, () => app);
