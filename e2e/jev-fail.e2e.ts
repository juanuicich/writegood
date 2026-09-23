/** A Jev request with no reply, in the real window (SPEC §8.4). The fake Jev
 *  answers HTTP 503 for one paragraph. That paragraph gets no notes and the
 *  status bar counts the failed call, but the pass does not fail. The next
 *  run asks Jev about that paragraph alone. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { e2e, FINDINGS, JEV_CATEGORY, JEV_WORDS, launch, statusText, until, type App } from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch({ jev: true });
}, 90_000);
afterAll(() => app?.close());

/** The paragraph of the draft that holds every word the fake Jev flags. */
const FAILING = "Unfortunately, the meeting";

const jevNotes = () =>
  app.browser.execute(
    (category) =>
      [...document.querySelectorAll<HTMLElement>(".margin .note")].filter(
        (n) => n.querySelector(".cat")?.textContent === category,
      ).length,
    JEV_CATEGORY,
  ) as Promise<number>;

const running = () => app.browser.execute(() => !!document.querySelector("footer .right .live"));

/** Detect requests: one per paragraph asked. */
const detects = () => app.jev!.calls.filter((c) => "s0" in c.body.questions);

e2e("a request with no reply fails only its paragraph", async () => {
  app.jev!.failOn = FAILING;
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "the run to finish", async () => {
    const placed = await app.browser.execute(() => document.querySelectorAll(".margin .note").length);
    return !(await running()) && placed === FINDINGS.length;
  }, 30_000);
  await until(app, "the summary", async () => (await statusText(app.browser)).includes("asked again next run"));
  const status = await statusText(app.browser);
  expect(status).toContain("1 failed call asked again next run");
  expect(status).not.toContain("failed:");
  expect(await jevNotes()).toBe(0);
  // Every other paragraph was asked, and answered.
  expect(detects().filter((c) => !String(c.body.state).includes(FAILING)).length).toBeGreaterThan(0);
}, () => app);

e2e("the next run asks Jev about that paragraph alone", async () => {
  app.jev!.failOn = null;
  const before = app.jev!.calls.length;
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "the Jev notes", async () => !(await running()) && (await jevNotes()) === JEV_WORDS.length, 30_000);
  const asked = detects().filter((c) => app.jev!.calls.indexOf(c) >= before);
  expect(asked).toHaveLength(1);
  expect(String(asked[0]!.body.state)).toContain(FAILING);
}, () => app);
