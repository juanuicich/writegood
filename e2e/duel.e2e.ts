/** The duel in the real window (SPEC §16.2): ⌘D opens it on the paragraph at
 *  the caret, ⌘R sends the rewrite to the judge, and the result names the
 *  version the judge picked, whichever side the shuffle put it on. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { caretAtEnd, e2e, launch, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
}, 60_000);
afterAll(() => app?.close());

/** Shorter than the paragraph it replaces, so the fake judge prefers it. */
const REWRITE = "Nobody resolved anything. The chair ran out the clock.";

e2e("⌘D opens the duel on the paragraph at the caret", async () => {
  const { browser } = app;
  await caretAtEnd(browser, ".ProseMirror p:nth-of-type(2)");
  await browser.keys([Key.Command, "d"]);
  await until(app, "the duel sheet", async () => browser.$(".sheet textarea").isExisting());
  expect(await browser.$(".sheet .original").getText()).toStartWith("There was an expectation");
}, () => app);

e2e("⌘R sends the rewrite to the judge, and the rewrite wins", async () => {
  const { browser } = app;
  const before = app.model.calls.length;
  await browser.$(".sheet textarea").setValue(REWRITE);
  await browser.keys([Key.Command, "r"]);
  await until(app, "the verdict", async () => browser.$(".sheet .verdict").isExisting());

  expect(await browser.$(".sheet .verdict").getText()).toBe("Your rewrite won.");
  // One call, to the judge, carrying both passages and nothing else.
  expect(app.model.calls.length).toBe(before + 1);
  const call = app.model.calls.at(-1)!;
  expect(call.prompt).toStartWith("Passage A:");
  expect(call.prompt).toContain(REWRITE);
  expect(call.prompt).toContain("There was an expectation");
}, () => app);
