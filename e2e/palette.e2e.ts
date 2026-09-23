/** The ⌘K palette in the real window (SPEC §12.2): the selected row stays in
 *  view as the arrows move it past the bottom of the list and back. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, launch, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
}, 60_000);
afterAll(() => app?.close());

/** Whether the selected row sits inside the list's visible box, and whether
 *  the list is long enough to scroll at all. */
const selectedInView = () =>
  app.browser.execute(() => {
    const list = document.querySelector(".bar ul")!;
    const row = list.querySelector("li.on")!;
    const box = list.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      scrolls: list.scrollHeight > list.clientHeight,
      inView: r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
      last: row === list.lastElementChild,
      first: row === list.firstElementChild,
    };
  });

e2e("the selected row stays in view going down and back up", async () => {
  const { browser } = app;
  await browser.keys([Key.Command, "k"]);
  await until(app, "the palette", async () => browser.$(".bar ul").isExisting());
  const rows = await browser.execute(() => document.querySelectorAll(".bar li").length);

  for (let i = 0; i < rows; i++) await browser.keys([Key.ArrowDown]);
  await until(app, "the last row in view", async () => {
    const s = await selectedInView();
    return s.last && s.inView;
  }, 3_000);
  expect((await selectedInView()).scrolls).toBe(true);

  for (let i = 0; i < rows; i++) await browser.keys([Key.ArrowUp]);
  await until(app, "the first row in view", async () => {
    const s = await selectedInView();
    return s.first && s.inView;
  }, 3_000);
}, () => app);
