/** What every end-to-end test needs (SPEC §16.2): a throwaway home, a fake
 *  model, and the real app launched against both with its WebDriver server on
 *  a port of its own.
 *
 *  The app under test is the debug binary that `bun run e2e` builds into
 *  src-tauri/target/e2e. Nothing here reads or writes the real ~/.writegood,
 *  and nothing leaves the machine. */
import { test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Key, remote } from "webdriverio";

export const BINARY = resolve(import.meta.dir, "../src-tauri/target/e2e/debug/writegood");

/** Marks the test pass's prompt, so the fake model knows which pass is asking. */
const MARKER = "E2E-PASS";

/** The fake model's rates, US dollars per million tokens, and what it reports
 *  for every call. A call then costs (1000 × 1 + 200 × 2) / 1e6 = $0.0014. */
const RATES = { input: 1, output: 2 };
const USAGE = { prompt_tokens: 1000, completion_tokens: 200 };
export const COST_PER_CALL = (USAGE.prompt_tokens * RATES.input + USAGE.completion_tokens * RATES.output) / 1e6;

export const TITLE = "The Determination of the Committee";

/** Long enough to scroll, so the margin has to follow the text. */
export const DRAFT = `# ${TITLE}

It was decided by the committee that a determination would be made regarding the proposal. Very few of the members had actually read it. Unfortunately, the meeting was conducted in a manner that was really quite unproductive.

There was an expectation that a resolution would be arrived at. No resolution was arrived at. The chair made the observation that time had expired, and the matter was tabled for a subsequent session.

The subsequent session began late. The secretary read the minutes of the previous meeting aloud, slowly, and nobody objected to any part of them.

A member from the finance office asked whether the proposal had a budget. The chair said a budget would be prepared. Nobody asked who would prepare it.

The proposal itself was four pages long. The first page described the problem. The second and third pages described a committee that would study the problem.

The fourth page was a list of names. Most of the names on it belonged to the people in the room, and two of them had left the organisation in the spring.

By the third session the room had changed. The old room had a window that faced the car park, and the new room had no window at all.

The members agreed that the new room was quieter. They did not agree on anything else, and the chair did not ask them to.

At the fourth session a visitor from another department attended. She listened for an hour, wrote nothing down, and left before the vote.

There was no vote. The chair said that a vote would be premature, and the members nodded, and the secretary wrote the word premature in the minutes.

Some of us left the room with the feeling that nothing had been accomplished. It is a feeling that is familiar. It is a feeling that recurs.
`;

/** What the fake model reports for the test pass, in the order the margin
 *  lists them: by where the drawn range starts, then by severity. Each quote
 *  appears once in the draft. `drawn` is what the highlight should cover once
 *  its edges are tidied (SPEC §12.3), when that differs from the quote.
 *
 *  Three overlap on "really quite", with loose edges on purpose: one starts
 *  with a space and stops short of the full stop, one takes the full stop.
 *  The last finding is in the last paragraph, below the first screen. */
export const FINDINGS: {
  quote: string;
  drawn?: string;
  category: string;
  severity: "low" | "medium" | "high";
  note: string;
}[] = [
  { quote: "a determination would be made", category: "nominalization", severity: "high", note: "The verb is buried in a noun." },
  { quote: "was really quite unproductive.", category: "tone", severity: "medium", note: "The sentence judges the meeting and reports nothing." },
  { quote: " really quite unproductive", drawn: "really quite unproductive.", category: "stacking", severity: "medium", note: "Two intensifiers stacked on one adjective." },
  { quote: "really quite", category: "filler", severity: "low", note: "Two intensifiers that add nothing." },
  { quote: "time had expired", category: "passive", severity: "medium", note: "The sentence hides who ended the meeting." },
  { quote: "It is a feeling that recurs.", category: "repetition", severity: "medium", note: "The same frame as the sentence before it." },
];

const PASS = `+++
name = "End to end"
category = "e2e"
scope = "document"
enabled = true
+++

${MARKER}. Report the problems the test expects.
`;

// ------------------------------------------------------------ the fake model

export interface Call {
  system: string;
  prompt: string;
}

export interface FakeModel {
  url: string;
  calls: Call[];
  stop(): void;
}

/** The text after the prompt's draft header, which is the plain text the app
 *  sent. Quotes are found in it, so prefix and suffix are what the app sees. */
function draftIn(prompt: string): string {
  const at = prompt.indexOf("--- the draft ---\n");
  if (at < 0) return prompt;
  const rest = prompt.slice(at + "--- the draft ---\n".length);
  const end = rest.indexOf("\n\n--- examine only this paragraph ---");
  return end < 0 ? rest : rest.slice(0, end);
}

function findingsFor(prompt: string): string {
  if (!prompt.includes(MARKER)) return "[]";
  const draft = draftIn(prompt);
  const found = FINDINGS.flatMap((f) => {
    const at = draft.indexOf(f.quote);
    if (at < 0) return [];
    const prefix = draft.slice(Math.max(0, at - 32), at);
    const suffix = draft.slice(at + f.quote.length, at + f.quote.length + 32);
    return [{ ...f, prefix, suffix }];
  });
  return "```json\n" + JSON.stringify(found, null, 2) + "\n```";
}

/** The judge prefers the shorter passage. A test's rewrite is shorter than
 *  the paragraph it replaces, so the rewrite should win on whichever side the
 *  shuffle put it. */
function verdictFor(prompt: string): string {
  const m = prompt.match(/^Passage A:\n\n([\s\S]*?)\n\nPassage B:\n\n([\s\S]*?)\n\nWhich passage/);
  if (!m) return JSON.stringify({ verdict: "tie", reason: "The fake judge could not read the passages." });
  const [a, b] = [m[1]!, m[2]!];
  const verdict = a.length < b.length ? "A" : b.length < a.length ? "B" : "tie";
  return JSON.stringify({ verdict, reason: "It is shorter." });
}

/** An OpenAI-compatible endpoint on 127.0.0.1 that answers without a model. */
export function fakeModel(): FakeModel {
  const calls: Call[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 });
      }
      const body = (await req.json()) as { model: string; messages: { role: string; content: unknown }[] };
      const text = (role: string) =>
        body.messages
          .filter((m) => m.role === role)
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n");
      const call = { system: text("system"), prompt: text("user") };
      calls.push(call);

      const content = call.prompt.startsWith("Passage A:") ? verdictFor(call.prompt) : findingsFor(call.prompt);
      return Response.json({
        id: `fake-${calls.length}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { ...USAGE, total_tokens: USAGE.prompt_tokens + USAGE.completion_tokens },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, calls, stop: () => server.stop(true) };
}

// ------------------------------------------------------------------ the home

/** A fresh WRITEGOOD_HOME: a config pointing at the fake model, the draft, the
 *  test pass, and a price catalog dated now so the app does not fetch one.
 *  The app adds the starter passes itself; the fake answers them with []. */
export function makeHome(modelUrl: string): string {
  const home = mkdtempSync(join(tmpdir(), "writegood-e2e-"));
  mkdirSync(join(home, "documents"));
  mkdirSync(join(home, "passes"));
  writeFileSync(join(home, "documents", "committee.md"), DRAFT);
  // The answer the open and save dialogs give (SPEC §6.3). The app starts on
  // an untitled draft, and launch() opens the draft with ⌘O through this.
  writeFileSync(join(home, "pick.txt"), join(home, "documents", "committee.md"));
  writeFileSync(join(home, "passes", "00-e2e.md"), PASS);
  writeFileSync(
    join(home, "config.toml"),
    `# Written by the e2e harness.
default_provider = "fake"
judge_provider = "judge"

[rules]
allow_suggestions  = false
redact_suggestions = true
forbid_praise      = true
blind_judge        = true

[appearance]
theme     = "light"
show_cost = true

[providers.fake]
kind     = "openai-compatible"
base_url = "${modelUrl}"
model    = "fake-model"
key_ref  = "env:WRITEGOOD_E2E_KEY"
catalog  = "e2e"
timeout_secs = 30

[providers.judge]
kind     = "openai-compatible"
base_url = "${modelUrl}"
model    = "fake-judge"
key_ref  = "env:WRITEGOOD_E2E_KEY"
catalog  = "e2e"
timeout_secs = 30
`,
  );
  writeFileSync(
    join(home, "prices.json"),
    JSON.stringify({
      fetchedAt: Math.floor(Date.now() / 1000),
      vendors: { e2e: { "fake-model": RATES, "fake-judge": RATES } },
    }),
  );
  return home;
}

// ------------------------------------------------------------------- the app

export interface App {
  browser: WebdriverIO.Browser;
  home: string;
  model: FakeModel;
  /** The app's own log, from the test home. */
  log(): string;
  close(): Promise<void>;
}

/** A port nothing is listening on. */
function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

async function waitFor(what: string, check: () => Promise<boolean>, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Launch the app with a fresh home and a fake model, and wait until the
 *  draft is in the editor. */
export async function launch(): Promise<App> {
  if (!existsSync(BINARY)) {
    throw new Error(`no test build at ${BINARY}. Run bun run e2e, which builds it first.`);
  }
  const model = fakeModel();
  const home = makeHome(model.url);
  const port = freePort();

  // Only what the app needs from this shell. Keys and other settings stay out.
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? home,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    WRITEGOOD_HOME: home,
    WRITEGOOD_PICK: join(home, "pick.txt"),
    WRITEGOOD_E2E_KEY: "fake",
    TAURI_WEBDRIVER_PORT: String(port),
  };
  const proc: ChildProcess = spawn(BINARY, [], { env, stdio: "ignore" });

  const log = () => {
    try {
      return readFileSync(join(home, "writegood.log"), "utf8");
    } catch {
      return "(no log)";
    }
  };
  const close = async () => {
    await browser?.deleteSession().catch(() => {});
    proc.kill();
    model.stop();
    rmSync(home, { recursive: true, force: true });
  };

  let browser: WebdriverIO.Browser | undefined;
  try {
    await waitFor("the WebDriver server", async () => (await fetch(`http://127.0.0.1:${port}/status`)).ok, 30_000);
    browser = await remote({ hostname: "127.0.0.1", port, capabilities: {}, logLevel: "error" });
    const b = browser;
    // A fresh home has no recent document, so the app starts untitled.
    await waitFor("the untitled draft", async () => (await statusText(b)).includes("untitled"), 30_000);
    await b.keys([Key.Command, "o"]);
    await waitFor("the draft", async () => (await editorText(b)).includes(TITLE), 30_000);
  } catch (e) {
    const tail = log();
    await close();
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n--- app log ---\n${tail}`);
  }
  return { browser, home, model, log, close };
}

// ------------------------------------------------------------------- helpers

/** Set what the next open or save dialog answers. An empty answer cancels. */
export function pick(app: App, path: string) {
  writeFileSync(join(app.home, "pick.txt"), path);
}

export const editorText = (b: WebdriverIO.Browser) =>
  b.execute(() => document.querySelector(".ProseMirror")?.textContent ?? "");

export const statusText = (b: WebdriverIO.Browser) =>
  b.execute(() => document.querySelector("footer")?.textContent?.replace(/\s+/g, " ").trim() ?? "");

/** The ids lit in the text. Overlapping findings share one span, so the ids
 *  are read from the per-finding classes (findings.ts), not `data-finding`. */
export const litInText = (b: WebdriverIO.Browser) =>
  b.execute(() => {
    const ids = new Set<string>();
    for (const span of document.querySelectorAll(".ProseMirror .finding-current")) {
      for (const c of span.classList) {
        const m = c.match(/^finding-lit-(\d+)$/);
        if (m) ids.add(m[1]!);
      }
    }
    return [...ids].sort();
  });

/** Bring the first element `selector` matches into view, and return a point
 *  10px inside its left edge, halfway down, in viewport coordinates. */
export async function pointAt(b: WebdriverIO.Browser, selector: string): Promise<{ x: number; y: number }> {
  return b.execute((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`nothing matches ${sel}`);
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(10, r.width / 2)), y: Math.round(r.top + r.height / 2) };
  }, selector);
}

/** Click at a point with pointer actions. An element click sends only a
 *  `click` event at 0,0, which ProseMirror ignores: it acts on mousedown
 *  (SPEC §16.1). */
export async function clickPoint(b: WebdriverIO.Browser, p: { x: number; y: number }) {
  await b.action("pointer").move({ x: p.x, y: p.y, origin: "viewport" }).down().up().perform();
}

/** Run every enabled pass with ⌘R and wait until each finding has a note. */
export async function runPasses(app: App) {
  await app.browser.keys([Key.Command, "r"]);
  // The run is over when the progress line is gone and every note is placed.
  await until(app, "the run to finish", async () => {
    const running = await app.browser.execute(() => !!document.querySelector("footer .right .live"));
    const placed = await app.browser.execute(() => document.querySelectorAll(".margin .note").length);
    return !running && placed === FINDINGS.length;
  }, 30_000);
}

/** Put the caret at the end of the first element `selector` matches. A
 *  synthetic click does not move the caret, so the selection is set through
 *  the DOM, which ProseMirror follows (SPEC §16.1). */
export async function caretAtEnd(b: WebdriverIO.Browser, selector: string) {
  await b.execute((sel: string) => {
    const target = document.querySelector(sel);
    const editor = document.querySelector<HTMLElement>(".ProseMirror");
    if (!target || !editor) throw new Error(`nothing matches ${sel}`);
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  // ProseMirror reads the DOM selection on selectionchange, which is async.
  await Bun.sleep(50);
}

/** Type at the end of the first element `selector` matches. */
export async function typeAtEnd(b: WebdriverIO.Browser, selector: string, text: string) {
  await caretAtEnd(b, selector);
  await b.$(".ProseMirror").addValue(text);
}

/** Wait for a condition in the page, with the app's log in the error. */
export async function until(app: App, what: string, check: () => Promise<boolean>, ms = 15_000) {
  try {
    await waitFor(what, check, ms);
  } catch (e) {
    throw new Error(`${(e as Error).message}\n--- status bar ---\n${await statusText(app.browser)}\n--- app log ---\n${app.log()}`);
  }
}

/** A test whose failure carries the app's log. */
export function e2e(name: string, body: () => Promise<void>, getApp: () => App | undefined, ms = 60_000) {
  test(
    name,
    async () => {
      try {
        await body();
      } catch (e) {
        const app = getApp();
        if (app && e instanceof Error && !e.message.includes("--- app log ---")) {
          e.message += `\n--- app log ---\n${app.log()}`;
        }
        throw e;
      }
    },
    ms,
  );
}
