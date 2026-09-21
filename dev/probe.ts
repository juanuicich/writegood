/** Exercise one pass against a real provider, outside the app.
 *
 *  The app talks to providers through Tauri's HTTP plugin, which only exists
 *  inside the webview. This script uses the same prompt, the same preamble and
 *  the same schema with the platform's own fetch, so the risky part — whether a
 *  given model returns findings that satisfy the contract — can be checked
 *  without launching anything.
 *
 *  Usage: bun dev/probe.ts [pass-slug] [provider-name]
 */
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateText, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { preamble } from "../src/lib/passes/schema";
import { buildPrompt, parseFindings } from "../src/lib/passes/parse";
import type { Pass, Rules } from "../src/lib/ipc";

const HOME = process.env.WRITEGOOD_HOME ?? join(homedir(), ".writegood");

function dotenv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of [HOME, process.cwd()]) {
    try {
      for (const line of readFileSync(join(dir, ".env"), "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const [k, ...rest] = t.replace(/^export /, "").split("=");
        const v = rest.join("=").trim().replace(/^["']|["']$/g, "");
        if (v) out[k.trim()] ??= v;
      }
    } catch {
      /* no .env here */
    }
  }
  return out;
}

/** Enough of config.toml to find a provider. Not a general TOML parser. */
function readConfig(): {
  defaultProvider: string;
  rules: Rules;
  providers: Record<string, Record<string, string>>;
} {
  const text = readFileSync(join(HOME, "config.toml"), "utf8");
  const providers: Record<string, Record<string, string>> = {};
  const rules: Record<string, boolean> = {};
  let section = "";
  let defaultProvider = "anthropic";

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const head = line.match(/^\[(.+)\]$/);
    if (head) {
      section = head[1];
      if (section.startsWith("providers.")) providers[section.slice(10)] ??= {};
      continue;
    }
    const pair = line.match(/^([\w_]+)\s*=\s*(.+)$/);
    if (!pair) continue;
    const key = pair[1];
    const value = pair[2].trim().replace(/^["']|["']$/g, "");
    if (section === "") {
      if (key === "default_provider") defaultProvider = value;
    } else if (section === "rules") {
      rules[key] = value === "true";
    } else if (section.startsWith("providers.")) {
      providers[section.slice(10)][key] = value;
    }
  }

  return {
    defaultProvider,
    providers,
    rules: {
      allowSuggestions: rules.allow_suggestions ?? false,
      redactSuggestions: rules.redact_suggestions ?? true,
      forbidPraise: rules.forbid_praise ?? true,
      blindJudge: rules.blind_judge ?? true,
    },
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

function model(config: ReturnType<typeof readConfig>, name: string, env: Record<string, string>) {
  const p = config.providers[name];
  if (!p) throw new Error(`no provider "${name}" in config.toml`);
  const keyName = (p.key_ref ?? "").replace(/^env:/, "");
  const apiKey = process.env[keyName] ?? env[keyName];
  if (!apiKey) throw new Error(`no key for ${name}: ${p.key_ref} resolves to nothing`);
  if (!p.model) throw new Error(`provider "${name}" has no model`);

  switch (p.kind) {
    case "anthropic":
      return createAnthropic({ apiKey })(p.model);
    case "openai":
      return createOpenAI({ apiKey })(p.model);
    case "openai-compatible":
      return createOpenAICompatible({ name, baseURL: p.base_url, apiKey })(p.model);
    default:
      throw new Error(`probe does not handle kind "${p.kind}"`);
  }
}

const raw = process.argv.includes("--raw");
const [slug = "nominalization", providerName] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));
const env = dotenv();
const config = readConfig();
const name = providerName ?? config.defaultProvider;
const pass = readPass(slug);

const draftPath = join(HOME, "documents", "on-writing.md");
const draft = readFileSync(draftPath, "utf8");

console.log(`pass     ${pass.pass.name}  (${pass.file})`);
console.log(`scope    whole draft in one call, whatever the pass declares`);
console.log(`provider ${name}  model ${config.providers[name]?.model}`);
console.log(`draft    ${draftPath}  ${draft.split(/\s+/).length} words\n`);

const started = Date.now();

const system = preamble(config.rules);
const prompt = buildPrompt(pass.pass, draft, null);
const llm = model(config, name, env);

if (raw) {
  // What the model actually sends back, before we try to read it.
  const { textStream } = streamText({ model: llm, system, prompt });
  for await (const chunk of textStream) process.stdout.write(chunk);
  console.log(`\n\n[raw, ${((Date.now() - started) / 1000).toFixed(1)}s]`);
  process.exit(0);
}

const { text } = await generateText({ model: llm, system, prompt });
const findings = parseFindings(text, name);

if (findings.length === 0) {
  // Either the model found nothing, or its items failed the schema. Show the
  // reply so the difference is visible.
  console.log("--- reply, first 800 characters ---");
  console.log(text.slice(0, 800));
  console.log("--- end ---\n");
}

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
