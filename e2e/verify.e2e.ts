/** Two stages, in the real window (SPEC §8.3): with thinking off, the app
 *  tells the provider so, drops candidates that repeat an earlier quote, asks
 *  three verifiers, and puts only what they keep in the margin. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, launch, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch({ thinking: "off" });
}, 90_000);
afterAll(() => app?.close());

const categories = () =>
  app.browser.execute(() =>
    [...document.querySelectorAll(".margin .note .cat")].map((n) => n.textContent ?? ""),
  ) as Promise<string[]>;

e2e("only the candidates the verifiers keep reach the margin", async () => {
  const { browser } = app;
  await browser.keys([Key.Command, "r"]);
  await until(app, "the run to finish with three notes", async () => {
    const running = await browser.execute(() => !!document.querySelector("footer .right .live"));
    return !running && (await categories()).length === 3;
  }, 30_000);
  // "really quite" and " really quite unproductive" repeat "was really quite
  // unproductive.", which the verifiers then drop.
  expect(await categories()).toEqual(["nominalization", "passive", "repetition"]);
}, () => app);

e2e("the test pass asks for thinking off, and three verifiers vote", async () => {
  const calls = app.model.calls;
  const verifiers = calls.filter((c) => c.system.startsWith("You are a senior copyeditor"));
  const testPass = calls.filter((c) => !verifiers.includes(c) && c.prompt.includes("E2E-PASS"));
  expect(verifiers).toHaveLength(3);
  expect(testPass.length).toBeGreaterThan(0);
  for (const c of [...testPass, ...verifiers]) expect(c.thinking).toEqual({ type: "disabled" });
}, () => app);

e2e("the paragraph-order starter turns thinking on for itself", async () => {
  // Its frontmatter says thinking = "high" (SPEC §8.1, §8.2).
  const order = app.model.calls.filter((c) => c.prompt.includes("category to 'paragraph-order'"));
  expect(order.length).toBe(1);
  expect(order[0]!.thinking).toEqual({ type: "enabled" });
}, () => app);
