/** Find and replace in the real window (SPEC §12.6): the bar opens on ⌘F,
 *  counts and steps through matches, closes on Esc, hides when review mode
 *  starts, and replaces one match or all of them. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, editorText, launch, statusText, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch();
}, 90_000);
afterAll(() => app?.close());

const bar = () =>
  app.browser.execute(() => {
    const find = document.querySelector(".find");
    if (!find) return null;
    return {
      count: find.querySelector(".count")?.textContent?.trim() ?? "",
      replace: !!find.querySelector("#replace-field"),
      focus: document.activeElement?.id ?? document.activeElement?.className ?? "",
    };
  });

const occurrences = async (word: string) => (await editorText(app.browser)).split(word).length - 1;

const count = (want: string) => async () => (await bar())?.count === want;

e2e("⌘F opens the bar on the find field, and typing counts the matches", async () => {
  const { browser } = app;
  await browser.keys([Key.Command, "f"]);
  await until(app, "the find field to take the focus", async () => (await bar())?.focus === "find-field", 5_000);
  await browser.keys("feeling".split(""));
  // Three in the last paragraph. The first match after the caret is selected.
  await until(app, "a count of three", async () => /^\d of 3$/.test((await bar())?.count ?? ""), 5_000);
  expect((await bar())!.replace).toBe(false);
}, () => app);

e2e("Enter and ⌘G step forward, ⌘⇧G steps back, and both wrap", async () => {
  const { browser } = app;
  const start = Number((await bar())!.count[0]);
  const after = (n: number) => `${((start - 1 + n + 3) % 3) + 1} of 3`;
  await browser.keys("Enter");
  await until(app, "the next match", count(after(1)), 5_000);
  await browser.keys([Key.Command, "g"]);
  await until(app, "the match after that", count(after(2)), 5_000);
  await browser.keys([Key.Command, Key.Shift, "g"]);
  await until(app, "the match before", count(after(1)), 5_000);
}, () => app);

e2e("Esc in the bar closes it and puts the caret back in the text", async () => {
  await app.browser.keys("Escape");
  await until(app, "the bar to close", async () => (await bar()) === null, 5_000);
  const state = await app.browser.execute(() => ({
    inText: !!document.activeElement?.closest(".ProseMirror"),
    matches: document.querySelectorAll(".ProseMirror-search-match, .ProseMirror-active-search-match").length,
  }));
  expect(state).toEqual({ inText: true, matches: 0 });
  expect(await statusText(app.browser)).not.toContain("review");
}, () => app);

e2e("entering review mode hides the bar, and ⌘F there returns to writing", async () => {
  const { browser } = app;
  await browser.keys([Key.Command, "f"]);
  await until(app, "the bar to open", async () => (await bar()) !== null, 5_000);
  await browser.execute(() => document.querySelector<HTMLElement>(".ProseMirror")!.focus());
  await browser.keys("Escape");
  await until(app, "review mode", async () => (await statusText(browser)).includes("review"), 5_000);
  expect(await bar()).toBeNull();
  expect(await browser.execute(() => document.querySelectorAll(".ProseMirror-search-match").length)).toBe(0);

  await browser.keys([Key.Command, "f"]);
  await until(app, "the bar to open in writing mode", async () => (await bar()) !== null, 5_000);
  expect(await statusText(browser)).not.toContain("review");
  // The query was kept for the session.
  expect((await bar())!.count).toMatch(/of 3$/);
  await browser.keys("Escape");
}, () => app);

e2e("⌥⌘F adds the replace field, and Enter there replaces one match", async () => {
  const { browser } = app;
  expect(await occurrences("subsequent")).toBe(2);
  await browser.keys([Key.Command, Key.Alt, "f"]);
  await until(app, "the replace field", async () => (await bar())?.replace === true, 5_000);
  // The find field holds "feeling" from before, so the replace field has the
  // focus. Empty the find field and search for something else. Typed keys
  // add to a field's text rather than replace its selection.
  await browser.execute(() => {
    const field = document.querySelector<HTMLInputElement>("#find-field")!;
    field.value = "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  });
  await browser.keys("subsequent".split(""));
  await until(app, "two matches", async () => /of 2$/.test((await bar())?.count ?? ""), 5_000);
  await browser.execute(() => document.querySelector<HTMLInputElement>("#replace-field")!.focus());
  await browser.keys("later".split(""));
  await browser.keys("Enter");
  await until(app, "one match replaced", async () => (await occurrences("subsequent")) === 1, 5_000);
  expect(await occurrences("later")).toBe(1);
}, () => app);

e2e("replace all from the palette replaces the rest, and ⌘Z undoes it", async () => {
  const { browser } = app;
  await browser.keys([Key.Command, "k"]);
  await browser.keys("replace all".split(""));
  await browser.keys("Enter");
  await until(app, "every match replaced", async () => (await occurrences("subsequent")) === 0, 5_000);
  expect(await occurrences("later")).toBe(2);
  expect(await statusText(browser)).toContain("replaced 1 match");

  await browser.execute(() => document.querySelector<HTMLElement>(".ProseMirror")!.focus());
  await browser.keys([Key.Command, "z"]);
  await until(app, "the replace all undone", async () => (await occurrences("subsequent")) === 1, 5_000);
}, () => app);
