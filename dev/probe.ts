/** Exercise one pass against a real provider, outside the app.
 *
 *  The prompt is built by the app's own preamble and prompt builder, then
 *  handed to the app's own network client — the Rust `probe` binary, which
 *  calls `llm::chat` exactly as the app does. The reply comes back through the
 *  app's parser. Every part of the path is the part that ships.
 *
 *  Usage: bun dev/probe.ts [pass-slug] [provider] [--raw]
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { preamble } from "../src/lib/passes/schema";
import { buildPrompt, parseFindings } from "../src/lib/passes/parse";
import type { Pass, Rules } from "../src/lib/ipc";

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

const raw = process.argv.includes("--raw");
const [slug = "nominalization", providerName] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));

const { file, pass } = readPass(slug);
const draftPath = join(HOME, "documents", "on-writing.md");
const draft = readFileSync(draftPath, "utf8");

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
