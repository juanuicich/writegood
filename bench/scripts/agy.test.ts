/** The benchmark runs agy through the app's runner with the block in
 *  `agy.toml`. These tests check that the block is the one SPEC §9.3 and
 *  DEFAULT_CONFIG give, and that the runner, called the way the benchmark
 *  calls it, builds the command line, directory and files SPEC §9.3 asks for.
 *  A fake command stands in for agy, so no model is called.
 *
 *  bun test bench */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGY_TOML, REPO, runCli } from "./lib";

type Block = { files: Record<string, string> } & Record<string, unknown>;
const agyBlock = (toml: string) => (Bun.TOML.parse(toml) as { providers: { agy: Block } }).providers.agy;

const bench = agyBlock(readFileSync(AGY_TOML, "utf8"));

describe("agy.toml", () => {
  test("matches the block in SPEC §9.3", () => {
    const spec = readFileSync(join(REPO, "SPEC.md"), "utf8");
    const from = spec.indexOf("**agy.** Google");
    const block = spec.slice(from).match(/```toml\n([\s\S]*?)```/)![1]!;
    expect(bench).toEqual(agyBlock(block));
  });

  test("matches the commented example in DEFAULT_CONFIG", () => {
    const source = readFileSync(join(REPO, "src-tauri", "src", "config.rs"), "utf8");
    const from = source.indexOf("# [providers.agy]");
    const to = source.indexOf('"#;', from);
    const block = source
      .slice(from, to)
      .split("\n")
      .map((l) => l.replace(/^# ?/, ""))
      .join("\n");
    expect(bench).toEqual(agyBlock(block));
  });
});

describe("the runner, called as the benchmark calls it", () => {
  // A stand-in for agy that prints what it was given, as JSON.
  const scratch = mkdtempSync(join(tmpdir(), "writegood-fake-agy-"));
  const fake = join(scratch, "fake-agy");
  writeFileSync(fake, `#!/usr/bin/env bun
const { readdirSync, readFileSync, realpathSync } = require("node:fs");
const files = {};
for (const f of readdirSync(".", { recursive: true, withFileTypes: true })) {
  if (!f.isFile()) continue;
  const path = require("node:path").relative(".", require("node:path").join(f.parentPath, f.name));
  files[path] = readFileSync(path, "utf8");
}
const argv = process.argv.slice(2);
const i = argv.indexOf("--add-dir");
console.log(JSON.stringify({
  response: "[]",
  argv,
  cwd: realpathSync(process.cwd()),
  addDir: i >= 0 ? realpathSync(argv[i + 1]) : null,
  files,
}));
`);
  chmodSync(fake, 0o755);

  const call = async (thinking?: string) => {
    const r = await runCli(AGY_TOML, "agy", "SYSTEM\n\nPROMPT {model}", { model: "gemini-3.8-flash", thinking, timeoutSecs: 30, command: fake });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    return JSON.parse(r.stdout) as { argv: string[]; cwd: string; addDir: string; files: Record<string, string> };
  };

  test("builds the command line from the block", async () => {
    const out = await call("off");
    expect(out.argv).toEqual([
      "-p", "SYSTEM\n\nPROMPT {model}",
      "--agent", "writegood",
      "--add-dir", out.argv[5]!,
      "--model", "gemini-3.8-flash-low",
      "--output-format", "json",
    ]);
    // --add-dir names the empty directory the command runs in.
    expect(out.addDir).toBe(out.cwd);
    expect(out.cwd).toContain("writegood-cli-");
    expect(existsSync(out.cwd)).toBe(false);
  }, 600_000);

  test("writes the block's files and nothing else", async () => {
    const out = await call("off");
    expect(out.files).toEqual(bench.files);
  }, 600_000);

  test("maps each thinking level through thinking_names", async () => {
    const model = async (t?: string) => (await call(t)).argv[7];
    expect(await model(undefined)).toBe("gemini-3.8-flash-low");
    expect(await model("low")).toBe("gemini-3.8-flash-low");
    expect(await model("medium")).toBe("gemini-3.8-flash-medium");
    expect(await model("high")).toBe("gemini-3.8-flash-high");
    expect(await model("max")).toBe("gemini-3.8-flash-high");
  }, 600_000);

  test("cleans up", () => {
    rmSync(scratch, { recursive: true, force: true });
  });
});
