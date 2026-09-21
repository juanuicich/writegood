/** Run one duel against a real judge, outside the app.
 *
 *  Uses the app's own shuffle, prompt and parser, so what passes here is what
 *  the app does. The two passages are fixed: the first is deliberately
 *  nominalised, the second is the same thought written plainly.
 *
 *  Usage: bun dev/probe-duel.ts [provider] [--raw] [--repeat N]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { judgePrompt, originalWon, parseVerdict, shuffle } from "../src/lib/duel/judge";

const HOME = process.env.WRITEGOOD_HOME ?? join(homedir(), ".writegood");

const ORIGINAL =
  "It was decided by the committee that a determination would be made regarding " +
  "the proposal. Very few of the members had actually read it.";
const REWRITE =
  "The committee decided to decide about the proposal later. Barely any of them " +
  "had read it.";

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const dir of [HOME, process.cwd()]) {
    try {
      for (const line of readFileSync(join(dir, ".env"), "utf8").split("\n")) {
        const t = line.trim().replace(/^export /, "");
        if (!t || t.startsWith("#")) continue;
        const [k, ...rest] = t.split("=");
        if (k.trim() === name) {
          const v = rest.join("=").trim().replace(/^["']|["']$/g, "");
          if (v) return v;
        }
      }
    } catch {
      /* no .env here */
    }
  }
  return undefined;
}

/** Enough of config.toml to find one provider. */
function provider(name?: string) {
  const text = readFileSync(join(HOME, "config.toml"), "utf8");
  const providers: Record<string, Record<string, string>> = {};
  let section = "";
  let fallback = "anthropic";
  let judge: string | undefined;

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
    const value = pair[2].trim().replace(/^["']|["']$/g, "");
    if (section === "") {
      if (pair[1] === "default_provider") fallback = value;
      if (pair[1] === "judge_provider") judge = value;
    } else if (section.startsWith("providers.")) {
      providers[section.slice(10)][pair[1]] = value;
    }
  }

  const pick = name ?? judge ?? fallback;
  const p = providers[pick];
  if (!p) throw new Error(`no provider "${pick}" in config.toml`);
  const apiKey = env((p.key_ref ?? "").replace(/^env:/, ""));
  if (!apiKey) throw new Error(`no key for ${pick}: ${p.key_ref} resolves to nothing`);

  const model =
    p.kind === "anthropic"
      ? createAnthropic({ apiKey })(p.model)
      : p.kind === "openai"
        ? createOpenAI({ apiKey })(p.model)
        : createOpenAICompatible({ name: pick, baseURL: p.base_url, apiKey })(p.model);

  return { pick, model, id: p.model };
}

const args = process.argv.slice(2);
const raw = args.includes("--raw");
const repeatAt = args.indexOf("--repeat");
const repeat = repeatAt >= 0 ? Number(args[repeatAt + 1] ?? 1) : 1;
const name = args.find((a) => !a.startsWith("--") && a !== String(repeat));

const { pick, model, id } = provider(name);
const { system } = judgePrompt("x", "y");

console.log(`judge    ${pick}  model ${id}`);
console.log(`prompt   ${/json/i.test(judgePrompt("x", "y").prompt) ? "says json" : "DOES NOT SAY JSON"}\n`);

if (raw) {
  const { aText, bText } = shuffle(ORIGINAL, REWRITE);
  const { prompt } = judgePrompt(aText, bText);
  console.log("--- system ---\n" + system + "\n\n--- prompt ---\n" + prompt + "\n");
  const { text } = await generateText({ model, system, prompt });
  console.log("--- reply ---\n" + text);
  process.exit(0);
}

let wins = { original: 0, rewrite: 0, ties: 0 };
for (let i = 0; i < repeat; i++) {
  const { aText, bText, aIsOriginal } = shuffle(ORIGINAL, REWRITE);
  const { prompt } = judgePrompt(aText, bText);
  const { text } = await generateText({ model, system, prompt });
  let verdict;
  try {
    verdict = parseVerdict(text, pick);
  } catch (e) {
    console.log(`${i + 1}. UNPARSEABLE: ${e instanceof Error ? e.message : e}`);
    console.log("--- reply ---\n" + text + "\n--- end ---\n");
    continue;
  }
  const won = originalWon(verdict.verdict, aIsOriginal);
  if (won === null) wins.ties += 1;
  else if (won) wins.original += 1;
  else wins.rewrite += 1;
  console.log(
    `${i + 1}. original shown as ${aIsOriginal ? "A" : "B"}, judge chose ${verdict.verdict} → ` +
      `${won === null ? "tie" : won ? "original" : "rewrite"}`,
  );
  console.log(`   ${verdict.reason}\n`);
}
if (repeat > 1) {
  console.log(`original ${wins.original}, rewrite ${wins.rewrite}, ties ${wins.ties}`);
}
