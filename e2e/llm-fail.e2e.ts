/** A model call with no reply, in the real window (SPEC §8.3). The test pass
 *  runs once per paragraph, and the fake model answers HTTP 503 for one
 *  paragraph. That paragraph gets no notes and the status bar counts the
 *  failed call, but the pass keeps its other findings and does not fail. The
 *  next run asks the model about that paragraph alone. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, examined, FINDINGS, launch, statusText, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch({ scope: "paragraph" });
}, 90_000);
afterAll(() => app?.close());

/** The paragraph of the draft that holds the first four findings. */
const FAILING = "Unfortunately, the meeting";
const elsewhere = FINDINGS.filter((f) => !f.quote.includes("determination") && !f.quote.includes("really"));

const notes = () => app.browser.execute(() => document.querySelectorAll(".margin .note").length);
const running = () => app.browser.execute(() => !!document.querySelector("footer .right .live"));

/** Calls of the test pass, from `from` on. */
const testCalls = (from = 0) => app.model.calls.slice(from).filter((c) => c.prompt.includes("E2E-PASS"));

e2e("a call with no reply fails only its paragraph", async () => {
  app.model.failOn = FAILING;
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "the summary", async () => !(await running()) && (await statusText(app.browser)).includes("asked again next run"), 30_000);
  const status = await statusText(app.browser);
  expect(status).toContain("1 failed call asked again next run");
  expect(status).not.toContain("failed:");
  expect(await notes()).toBe(elsewhere.length);
  // Every paragraph was asked, and only one call failed.
  const failed = testCalls().filter((c) => examined(c.prompt)?.includes(FAILING));
  expect(failed).toHaveLength(1);
  expect(testCalls().length).toBeGreaterThan(1);
}, () => app);

e2e("the next run asks the model about that paragraph alone", async () => {
  app.model.failOn = null;
  const before = app.model.calls.length;
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "every note", async () => !(await running()) && (await notes()) === FINDINGS.length, 30_000);
  const asked = testCalls(before);
  expect(asked).toHaveLength(1);
  expect(examined(asked[0]!.prompt)).toContain(FAILING);
  expect(await statusText(app.browser)).not.toContain("failed");
}, () => app);
