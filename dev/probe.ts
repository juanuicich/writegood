/** Exercise one pass against a real provider, outside the app.
 *
 *  The prompt is built by the app's own preamble and prompt builder, then
 *  handed to the app's own network client — the Rust `probe` binary, which
 *  calls `llm::chat` exactly as the app does, or `runner::run` for a `cli`
 *  provider. The reply comes back through the app's parser. Every part of the
 *  path is the part that ships.
 *
 *  A pass on a `jev` provider runs through the app's own `jev.ts`, one
 *  paragraph at a time, and each request goes through `jev::ask` in the
 *  probe binary (SPEC §8.4).
 *
 *  Usage: bun dev/probe.ts [pass-slug] [provider] [--raw] [--draft <file>]
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { preamble } from "../src/lib/passes/schema";
import { buildPrompt, paragraphStarts, paragraphs, parseFindings } from "../src/lib/passes/parse";
import { jevSettings, paragraphFindings, Unreadable, type Ask } from "../src/lib/passes/jev";
import { limiter } from "../src/lib/passes/limit";
import type { JevReply, NewFinding, Pass, Provider, Rules } from "../src/lib/ipc";

const HOME = process.env.WRITEGOOD_HOME ?? join(homedir(), ".writegood");

/** Enough of config.toml to read the rules. The Rust side reads it properly
 *  for everything else; this only needs to build the same preamble. */
function readRules(): Rules {
  const text = readFileSync(join(HOME, "config.toml"), "utf8");
  const rules: Record<string, boolean> = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const head = line.match(/^\[(.+)\]$/);
    if (head) {
      section = head[1];
      continue;
    }
    const pair = line.match(/^([\w_]+)\s*=\s*(.+)$/);
    if (pair && section === "rules") rules[pair[1]] = pair[2].trim() === "true";
  }
  return {
    allowSuggestions: rules.allow_suggestions ?? false,
    redactSuggestions: rules.redact_suggestions ?? true,
    forbidPraise: rules.forbid_praise ?? true,
    blindJudge: rules.blind_judge ?? true,
  };
}

function readPass(slug: string) {
  const dir = join(HOME, "passes");
  const file = readdirSync(dir).find((f) => f.includes(slug));
  if (!file) throw new Error(`no pass matching "${slug}" in ${dir}`);
  const text = readFileSync(join(dir, file), "utf8");
  const parts = text.split(/^\+\+\+$/m);
  if (parts.length < 3) throw new Error(`${file} has no +++ frontmatter`);
  const meta = parts[1];
  const field = (k: string) => meta.match(new RegExp(`^\\s*${k}\\s*=\\s*"(.+)"\\s*$`, "m"))?.[1];
  const pass: Pass = {
    slug,
    name: field("name") ?? file,
    category: field("category") ?? slug,
    scope: (field("scope") as Pass["scope"]) ?? "paragraph",
    provider: field("provider") ?? null,
    enabled: true,
    prompt: parts.slice(2).join("+++").trim(),
    path: join(dir, file),
    jev: (Bun.TOML.parse(meta) as { jev?: Pass["jev"] }).jev ?? null,
  };
  return { file, pass };
}

/** Run the app's network client through the Rust probe binary. */
async function ask(provider: string | undefined, system: string, prompt: string) {
  const dir = mkdtempSync(join(tmpdir(), "writegood-probe-"));
  const systemFile = join(dir, "system.txt");
  const promptFile = join(dir, "prompt.txt");
  writeFileSync(systemFile, system);
  writeFileSync(promptFile, prompt);

  const args = ["run", "-q", "--example", "probe", "--", "--system", systemFile, "--prompt", promptFile];
  if (provider) args.push("--provider", provider);

  const child = Bun.spawn(["cargo", ...args], {
    cwd: join(import.meta.dir, "..", "src-tauri"),
    stdout: "pipe",
    stderr: "inherit",
  });
  const text = await new Response(child.stdout).text();
  const code = await child.exited;
  if (code !== 0) throw new Error(`probe exited ${code}`);
  return text;
}

/** The probe binary, built once, so parallel requests do not wait on
 *  cargo's lock. */
const SRC_TAURI = join(import.meta.dir, "..", "src-tauri");
async function probeBinary(): Promise<string> {
  const build = Bun.spawn(["cargo", "build", "-q", "--example", "probe"], { cwd: SRC_TAURI, stderr: "inherit" });
  if ((await build.exited) !== 0) throw new Error("cargo build --example probe failed");
  return join(SRC_TAURI, "target", "debug", "examples", "probe");
}

/** Run a pass on a jev provider over every paragraph of the draft. */
async function probeJev(pass: Pass, name: string, provider: Provider, draft: string) {
  const binary = await probeBinary();
  const dir = mkdtempSync(join(tmpdir(), "writegood-probe-jev-"));
  const limit = limiter(provider.maxInFlight ?? 8);
  let n = 0;
  let cost = 0;
  let priced = true;
  let tokens = 0;
  const models = new Set<string>();
  const ask: Ask = (state, questions) =>
    limit(async () => {
      const file = join(dir, `request-${n++}.json`);
      writeFileSync(file, JSON.stringify({ state, questions }));
      const child = Bun.spawn([binary, "--provider", name, "--jev", file], { cwd: SRC_TAURI, stdout: "pipe", stderr: "pipe" });
      const out = await new Response(child.stdout).text();
      const err = await new Response(child.stderr).text();
      if ((await child.exited) !== 0) throw new Error(err.trim() || "probe failed");
      const reply = JSON.parse(out) as JevReply;
      tokens += reply.tokens?.input ?? 0;
      if (reply.costUsd === null) priced = false;
      else cost += reply.costUsd;
      if (reply.model) models.add(reply.model);
      return reply;
    });

  const settings = jevSettings(pass, provider);
  const paras = paragraphs(draft);
  const starts = paragraphStarts(draft);
  const points = Array.from(draft);
  let unreadable = 0;
  const found: NewFinding[][] = await Promise.all(
    paras.map(async (p, i) => {
      try {
        return (await paragraphFindings(pass, settings, p, { points, start: starts[i]! }, ask)) ?? [];
      } catch (e) {
        if (!(e instanceof Unreadable)) throw e;
        unreadable += 1;
        console.log(`paragraph ${i + 1}: ${e.message}`);
        return [];
      }
    }),
  );
  const all = found.flat();
  all.forEach((f, i) => {
    console.log(`${i + 1}. [${f.severity}] ${f.category}`);
    console.log(`   \u201c${f.quote}\u201d  (after \u201c${f.prefix.slice(-20)}\u201d)`);
    console.log(`   ${f.note}\n`);
  });
  const money = priced ? `$${cost.toFixed(5)}` : "no price";
  console.log(
    `${all.length} findings, ${paras.length} paragraphs, ${n} requests, ${tokens} input tokens, ${money}, ` +
      `${unreadable} unreadable, model ${[...models].join(", ") || "unknown"}`,
  );
}

const raw = process.argv.includes("--raw");
const draftAt = process.argv.indexOf("--draft");
const draftFlag = draftAt >= 0 ? process.argv[draftAt + 1] : undefined;
const [slug = "nominalization", providerName] = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--draft");

const { file, pass } = readPass(slug);
const draftPath = draftFlag ?? join(HOME, "documents", "on-writing.md");
const draft = readFileSync(draftPath, "utf8");

const config = Bun.TOML.parse(readFileSync(join(HOME, "config.toml"), "utf8")) as {
  default_provider?: string;
  providers?: Record<string, { kind?: string; keep?: number; max_in_flight?: number; model?: string }>;
};
const jevName = providerName ?? pass.provider ?? config.default_provider ?? "";
const jevProvider = config.providers?.[jevName];
if (jevProvider?.kind === "jev") {
  console.log(`pass     ${pass.name}  (${file}) on ${jevName} (${jevProvider.model ?? "no model"})`);
  console.log(`draft    ${draftPath}  ${draft.split(/\s+/).length} words\n`);
  const started = Date.now();
  await probeJev(
    pass,
    jevName,
    { kind: "jev", args: [], timeoutSecs: 60, keep: jevProvider.keep ?? null, maxInFlight: jevProvider.max_in_flight ?? null },
    draft,
  );
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(0);
}

console.log(`pass     ${pass.name}  (${file})`);
console.log(`scope    whole draft in one call, whatever the pass declares`);
console.log(`draft    ${draftPath}  ${draft.split(/\s+/).length} words\n`);

const started = Date.now();
const system = preamble(readRules());
const prompt = buildPrompt(pass, draft, null);
const text = await ask(providerName, system, prompt);

if (raw) {
  console.log(text);
  console.log(`\n[raw, ${((Date.now() - started) / 1000).toFixed(1)}s]`);
  process.exit(0);
}

const findings = parseFindings(text, providerName ?? "the provider");

let misquoted = 0;
findings.forEach((f, i) => {
  const quoted = draft.includes(f.quote);
  if (!quoted) misquoted += 1;
  console.log(`${i + 1}. [${f.severity}] ${f.category}${quoted ? "" : "   QUOTE NOT IN DRAFT"}`);
  console.log(`   \u201c${f.quote}\u201d`);
  console.log(`   ${f.note}\n`);
});

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${findings.length} findings in ${secs}s, ${misquoted} with a quote not in the draft`);
