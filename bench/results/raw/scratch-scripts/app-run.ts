/** Run all passes in the real app against the real provider, in a throwaway
 *  home, and time it from ⌘R: first note, and run finished. Then read what
 *  each pass cost from that home's database.
 *
 *  Usage: bun app-run.ts <draft.md> */
import { spawn } from "node:child_process";
import { Database } from "bun:sqlite";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Key } from "webdriverio";

const REPO = "<repo>";
const { remote } = await import(`${REPO}/node_modules/webdriverio/build/index.js`);
const BINARY = join(REPO, "src-tauri/target/e2e/debug/writegood");
const REAL = join(homedir(), ".writegood");
const draft = process.argv[2]!;

const home = mkdtempSync(join(tmpdir(), "writegood-run-"));
mkdirSync(join(home, "documents"));
cpSync(join(REAL, "passes"), join(home, "passes"), { recursive: true });
copyFileSync(join(REAL, "config.toml"), join(home, "config.toml"));
copyFileSync(join(REAL, ".env"), join(home, ".env"));
const doc = join(home, "documents", basename(draft));
copyFileSync(draft, doc);
writeFileSync(join(home, "pick.txt"), doc);

const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
const port = probe.port;
probe.stop(true);
const proc = spawn(BINARY, [], {
  env: {
    PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? "/tmp",
    WRITEGOOD_HOME: home, WRITEGOOD_PICK: join(home, "pick.txt"),
    TAURI_WEBDRIVER_PORT: String(port), WRITEGOOD_BACKGROUND: "1",
  },
  stdio: "ignore",
});

const wait = async (what: string, check: () => Promise<boolean>, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
};

try {
  await wait("webdriver", async () => (await fetch(`http://127.0.0.1:${port}/status`)).ok, 30_000);
  const b = await remote({ hostname: "127.0.0.1", port, capabilities: {}, logLevel: "error" });
  const text = () => b.execute(() => document.querySelector(".ProseMirror")?.textContent ?? "") as Promise<string>;
  await wait("untitled", async () => (await b.execute(() => document.querySelector("footer")?.textContent ?? "")).includes("untitled"), 30_000);
  await b.keys([Key.Command, "o"]);
  await wait("draft", async () => (await text()).length > 100, 30_000);

  const notes = () => b.execute(() => document.querySelectorAll(".margin .note").length) as Promise<number>;
  const running = () => b.execute(() => !!document.querySelector("footer .right .live")) as Promise<boolean>;
  const runOnce = async (label: string) => {
    const before = await notes();
    const t0 = Date.now();
    await b.keys([Key.Command, "r"]);
    let first: number | null = null;
    await wait("the run", async () => {
      if (first === null && (await notes()) !== before) first = (Date.now() - t0) / 1000;
      return Date.now() - t0 > 1500 && !(await running());
    }, 600_000);
    const last = (Date.now() - t0) / 1000;
    const status = await b.execute(() => document.querySelector("footer .right")?.textContent ?? "");
    console.log(`${label}: first change ${first?.toFixed(1) ?? "none"}s, run finished ${last.toFixed(1)}s, ${await notes()} notes`);
    console.log(`  status: ${String(status).trim()}`);
  };
  await runOnce(`${basename(draft)} first run`);
  if (process.argv.includes("--edit")) {
    // Type at the end of the middle paragraph, then run again; then run once
    // more with no edit.
    await b.execute(() => {
      const ps = document.querySelectorAll(".ProseMirror p");
      const target = ps[Math.floor(ps.length / 2)]!;
      const editor = document.querySelector<HTMLElement>(".ProseMirror")!;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await Bun.sleep(100);
    await b.$(".ProseMirror").addValue(" This sentence was added.");
    await runOnce("after editing one paragraph");
    await runOnce("with no edit");
  }
  await b.deleteSession();

  const db = new Database(join(home, "writegood.db"), { readonly: true });
  const rows = db.query(
    `select pass_slug, status, error, cost_usd, input_tokens, output_tokens,
            (julianday(finished_at) - julianday(started_at)) * 86400 as secs,
            (select count(*) from findings f where f.run_id = runs.id) as found
     from runs order by id`,
  ).all() as any[];
  let cost = 0;
  for (const r of rows) {
    cost += r.cost_usd ?? 0;
    console.log(`  ${r.pass_slug.padEnd(18)} ${r.status.padEnd(5)} ${String(r.found).padStart(2)} findings  ${r.secs.toFixed(0).padStart(3)}s  $${(r.cost_usd ?? 0).toFixed(4)}  in ${r.input_tokens} out ${r.output_tokens}${r.error ? "  " + r.error.slice(0, 80) : ""}`);
  }
  console.log(`  total cost $${cost.toFixed(4)}`);
} finally {
  proc.kill();
  rmSync(home, { recursive: true, force: true });
}
