/** A pass on Jev, in the real window (SPEC §8.4, §9.5). The test process
 *  serves a fake Jev. The app sends it the paragraph and the pass's rule
 *  text, reads the answers, and puts one note per chosen span in the margin.
 *  The quote is the draft's own words and the note is the pass's fixed
 *  text. A rerun with no edits asks Jev nothing. */
import { afterAll, beforeAll, expect } from "bun:test";
import { Key } from "webdriverio";
import { paragraphs } from "../src/lib/passes/parse";
import { dollars } from "../src/lib/usage";
import {
  COST_PER_CALL,
  DRAFT,
  e2e,
  FINDINGS,
  JEV_CATEGORY,
  JEV_COST_PER_CALL,
  JEV_NOTE,
  JEV_RULE,
  JEV_WORDS,
  launch,
  statusText,
  until,
  type App,
} from "./harness";

let app: App;
beforeAll(async () => {
  app = await launch({ jev: true });
}, 90_000);
afterAll(() => app?.close());

interface Note {
  category: string;
  note: string;
  highlight: string;
}

const notes = () =>
  app.browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".margin .note")].map((n) => ({
      category: n.querySelector(".cat")?.textContent ?? "",
      note: n.querySelector("p")?.textContent?.trim() ?? "",
      highlight: [...document.querySelectorAll(`.ProseMirror .finding-id-${n.dataset.note}`)]
        .map((s) => s.textContent)
        .join(""),
    })),
  ) as Promise<Note[]>;

const running = () => app.browser.execute(() => !!document.querySelector("footer .right .live"));

/** Run every enabled pass and wait until the run is over and every note,
 *  the fake model's and Jev's, is placed. */
async function run() {
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "the run to finish", async () => {
    const placed = (await notes()).length;
    return !(await running()) && placed === FINDINGS.length + JEV_WORDS.length;
  }, 30_000);
}

e2e("a pass on Jev puts one note per chosen span in the margin", async () => {
  await run();
  const jev = (await notes()).filter((n) => n.category === JEV_CATEGORY);
  expect(jev).toEqual(JEV_WORDS.map((w) => ({ category: JEV_CATEGORY, note: JEV_NOTE, highlight: w })));
}, () => app);

e2e("every request carries the paragraph as state and the rule text word for word", async () => {
  const calls = app.jev!.calls;
  expect(calls.length).toBeGreaterThan(0);
  const paras = paragraphs(DRAFT);
  for (const c of calls) {
    expect(c.authorization).toBe("Bearer fake");
    expect(c.body.model).toBe("jev-1.13.0");
    // The heading loses its "# " in the editor's text, so the state is
    // compared with the draft as a whole.
    expect(DRAFT).toContain(c.body.state as string);
    for (const q of Object.values(c.body.questions)) expect(q.instructions.rule).toBe(JEV_RULE);
  }
  // One detect request per paragraph. Each kept sentence has a round that
  // picks its word and a round that answers none.
  const detect = calls.filter((c) => "s0" in c.body.questions);
  expect(detect).toHaveLength(paras.length);
  expect(calls.length - detect.length).toBe(2 * JEV_WORDS.length);
}, () => app);

e2e("the status bar adds Jev's cost, priced from config.toml", async () => {
  const spent = await app.browser.$("footer .spent").getText();
  expect(spent).toBe(dollars(app.model.calls.length * COST_PER_CALL + app.jev!.calls.length * JEV_COST_PER_CALL));
}, () => app);

e2e("a rerun with no edits asks Jev nothing", async () => {
  const before = app.jev!.calls.length;
  await app.browser.keys([Key.Command, "r"]);
  await until(app, "the rerun to finish", async () => !(await running()) && (await statusText(app.browser)).includes("reused"));
  expect(app.jev!.calls.length).toBe(before);
  const jev = (await notes()).filter((n) => n.category === JEV_CATEGORY);
  expect(jev.map((n) => n.highlight)).toEqual(JEV_WORDS);
}, () => app);
