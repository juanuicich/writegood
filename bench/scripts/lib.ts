/** Shared parts of the benchmark: paths, keys, rule sets, drafts, and the
 *  providers.
 *
 *  The prompts, the preamble, the parser, the filters and the verifier come
 *  from the app (src/lib/passes). The benchmark changes the provider, the
 *  model and the rules, and nothing else. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Pass } from "../../src/lib/ipc";
import { limiter } from "../../src/lib/passes/limit";

export const BENCH = resolve(import.meta.dir, "..");
export const REPO = resolve(BENCH, "..");
export const CORPUS = join(BENCH, "corpus");
export const RULES = join(BENCH, "rules");
export const RESULTS = join(BENCH, "results");

/** The four drafts with reference findings. */
export const SCORED = ["draft-essay.md", "draft-memo.md", "draft-story.md", "on-writing.md"];

export function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// ---------------------------------------------------------------- keys

/** A key from the repo's .env, then from ~/.writegood/.env. The value is
 *  never printed. */
export function key(name: string): string {
  for (const file of [join(REPO, ".env"), join(homedir(), ".writegood", ".env")]) {
    if (!existsSync(file)) continue;
    const m = readFileSync(file, "utf8").match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, "m"));
    if (m) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} is not set in .env or ~/.writegood/.env`);
}

// ---------------------------------------------------------------- drafts

export function draftPath(name: string): string {
  const p = join(CORPUS, basename(name));
  if (existsSync(p)) return p;
  if (existsSync(name)) return name;
  throw new Error(`no draft ${name} in ${CORPUS}`);
}

export const stem = (d: string) => basename(d).replace(/^draft-/, "").replace(/\.md$/, "");
export const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------- rules

export type Thinking = "off" | "none" | "on" | "low" | "medium" | "high" | "max" | "default";

/** The thinking levels each provider can take. `none` and `on` are
 *  OpenRouter's. DeepSeek has an on and off switch and effort levels. agy
 *  takes the app's levels, which its `thinking_names` map to a model. */
export const LEVELS_FOR: Record<Provider["name"], Thinking[]> = {
  openrouter: ["off", "none", "on", "low", "medium", "high", "max", "default"],
  deepseek: ["off", "low", "medium", "high", "max", "default"],
  agy: ["off", "low", "medium", "high", "max", "default"],
};

/** An error that names the levels a provider cannot take, or null. */
export function refuseLevels(provider: Provider["name"], levels: Iterable<Thinking>): string | null {
  const allowed = LEVELS_FOR[provider];
  const bad = [...new Set(levels)].filter((l) => !allowed.includes(l));
  if (!bad.length) return null;
  return `${provider} cannot take thinking ${bad.map((l) => `"${l}"`).join(", ")}; it takes ${allowed.join(", ")}`;
}

/** A level that asks for no reasoning. */
export const quick = (t: Thinking) => t === "off" || t === "none";

/** A pass as the app reads it, from one rule file. */
export function loadRules(name: string): Pass[] {
  const dir = join(RULES, name);
  if (!existsSync(dir)) {
    const known = readdirSync(RULES).join(", ");
    throw new Error(`no rule set "${name}" in ${RULES}; known: ${known}`);
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((file): Pass[] => {
      const text = readFileSync(join(dir, file), "utf8");
      const parts = text.split(/^\+\+\+$/m);
      const meta = parts[1]!;
      const field = (k: string) =>
        meta.match(new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\n]+?)"?\\s*$`, "m"))?.[1];
      if (field("enabled") === "false") return [];
      const category = field("category") ?? file;
      const timeout = field("timeout_secs");
      return [{
        slug: category,
        name: field("name") ?? file,
        category,
        scope: (field("scope") ?? "paragraph") as Pass["scope"],
        provider: null,
        enabled: true,
        prompt: parts.slice(2).join("+++").trim(),
        path: join(dir, file),
        thinking: (field("thinking") as Pass["thinking"]) ?? null,
        timeoutSecs: timeout ? Number(timeout) : null,
      }];
    });
}

// ---------------------------------------------------------------- providers

export interface Usage {
  input: number;
  cacheRead: number;
  output: number;
  reasoning: number;
  cost: number;
  /** "reported" when the provider returned the cost, "rates" when it is
   *  computed from a price table. */
  costSource: "reported" | "rates";
  /** The upstream provider that served the call, when the API says. */
  servedBy?: string;
  /** agy: seconds from spawning the process to its exit, without the wait
   *  for a slot. */
  serviceSecs?: number;
}

export interface Provider {
  name: "deepseek" | "openrouter" | "agy";
  model: string;
  /** OpenRouter only: the one upstream provider allowed to serve the call. */
  pinned?: string;
  chat(system: string, prompt: string, thinking: Thinking, ceilingSecs: number): Promise<{ text: string; usage: Usage }>;
}

/** DeepSeek prices per million tokens, as in the app's price table
 *  (models.dev, read by src-tauri/src/prices.rs). */
const DEEPSEEK_RATES: Record<string, { input: number; cache: number; output: number }> = {
  "deepseek-flash": { input: 0.15, cache: 0.003, output: 0.6 },
  "deepseek-v4-pro": { input: 0.435, cache: 0.003625, output: 0.87 },
};

/** The first-party OpenRouter provider for a model's vendor. */
const FIRST_PARTY: Record<string, string> = {
  deepseek: "deepseek",
  openai: "openai",
  anthropic: "anthropic",
  google: "google-ai-studio",
  mistralai: "mistral",
  "x-ai": "xai",
  qwen: "alibaba",
  moonshotai: "moonshotai",
  "z-ai": "z-ai",
  inception: "inception",
  xiaomi: "xiaomi",
  minimax: "minimax",
  cohere: "cohere",
};

export function firstParty(model: string): string {
  const vendor = model.split("/")[0]!;
  const p = FIRST_PARTY[vendor];
  if (!p) throw new Error(`no known first-party provider for "${vendor}"; pass --or-provider`);
  return p;
}

async function post(url: string, auth: string, body: unknown, ceilingSecs: number): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ceilingSecs * 1000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await r.text();
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`${r.status} ${text.slice(0, 200)}`);
    }
    if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    return j;
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(`did not answer within ${ceilingSecs}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function deepseek(model: string): Provider {
  const auth = key("DEEPSEEK_API_KEY");
  const rates = DEEPSEEK_RATES[model];
  if (!rates) throw new Error(`no DeepSeek rates for ${model}; add them to DEEPSEEK_RATES in lib.ts`);
  return {
    name: "deepseek",
    model,
    async chat(system, prompt, thinking, ceilingSecs) {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      };
      // DeepSeek's own switch. "low" does not shorten Flash's thinking.
      if (thinking === "off") body.thinking = { type: "disabled" };
      else if (thinking === "none" || thinking === "on") throw new Error(`DeepSeek has no level "${thinking}"`);
      else if (thinking !== "default") {
        body.thinking = { type: "enabled" };
        body.reasoning_effort = thinking;
      }
      const j = await post("https://api.deepseek.com/v1/chat/completions", auth, body, ceilingSecs);
      const u = j.usage ?? {};
      const input = u.prompt_tokens ?? 0;
      const cacheRead = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
      const output = u.completion_tokens ?? 0;
      return {
        text: j.choices?.[0]?.message?.content ?? "",
        usage: {
          input, cacheRead, output,
          reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
          cost: ((input - cacheRead) * rates.input + cacheRead * rates.cache + output * rates.output) / 1e6,
          costSource: "rates",
          servedBy: "deepseek",
        },
      };
    },
  };
}

/** `cacheControl` marks the system prompt and the shared head of the user
 *  prompt (the draft and the task) with `cache_control` breakpoints. Alibaba
 *  caches only what a breakpoint marks. */
export function openrouter(model: string, pinned: string, cacheControl = false): Provider {
  const auth = key("OPENROUTER_API_KEY");
  return {
    name: "openrouter",
    model,
    pinned,
    async chat(system, prompt, thinking, ceilingSecs) {
      const mark = { type: "ephemeral" };
      const at = prompt.indexOf("\n\n--- examine only this paragraph ---");
      const messages = cacheControl
        ? [
          { role: "system", content: [{ type: "text", text: system, cache_control: mark }] },
          {
            role: "user",
            content: at < 0
              ? [{ type: "text", text: prompt, cache_control: mark }]
              : [{ type: "text", text: prompt.slice(0, at), cache_control: mark }, { type: "text", text: prompt.slice(at) }],
          },
        ]
        : [{ role: "system", content: system }, { role: "user", content: prompt }];
      const body: Record<string, unknown> = {
        model,
        messages,
        // One upstream provider, no fallback: a result names what served it.
        provider: { only: [pinned], allow_fallbacks: false },
        // Usage is always returned now; the flag is harmless and asks for cost.
        usage: { include: true },
      };
      // "off" and "on" switch reasoning without a level, for models with no
      // effort levels. "none" is OpenAI's effort level that turns it off.
      if (thinking === "off") body.reasoning = { enabled: false };
      else if (thinking === "on") body.reasoning = { enabled: true };
      else if (thinking !== "default") body.reasoning = { effort: thinking };
      const j = await post("https://openrouter.ai/api/v1/chat/completions", auth, body, ceilingSecs);
      const u = j.usage ?? {};
      return {
        text: j.choices?.[0]?.message?.content ?? "",
        usage: {
          input: u.prompt_tokens ?? 0,
          cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0,
          output: u.completion_tokens ?? 0,
          reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
          cost: Number(u.cost ?? 0),
          costSource: "reported",
          servedBy: j.provider ?? undefined,
        },
      };
    },
  };
}

/** A custom agent with no tools, no MCP servers, no inherited rules or
 *  skills, and none of agy's default prompt. agy reads it from
 *  `.agents/agents/writegood/agent.md` in its workspace and runs it with
 *  `--agent writegood`. */
export const AGY_AGENT = `---
name: writegood
description: Answers one prompt from its text alone.
mainAgent: true
subagent: false
tools: []
inheritMcp: false
inheritCustomizations: false
excludeDefaultComponents: true
---
Answer the user's message from its text alone. You have no tools.
`;

/** Write the agent and the hook into an empty directory. */
export function agyWorkspace(dir: string) {
  mkdirSync(join(dir, ".agents", "agents", "writegood"), { recursive: true });
  writeFileSync(join(dir, ".agents", "agents", "writegood", "agent.md"), AGY_AGENT);
  writeFileSync(join(dir, ".agents", "hooks.json"), AGY_DENY_HOOKS);
}

/** A second guard: a PreToolUse hook that denies every tool. agy reads it
 *  from `.agents/hooks.json` in its workspace. */
export const AGY_DENY_HOOKS = JSON.stringify({
  "writegood-no-tools": {
    PreToolUse: [{
      matcher: "*",
      hooks: [{
        type: "command",
        command: `echo '{"decision":"deny","reason":"Tools are off. Answer from the prompt alone."}'`,
        timeout: 5,
      }],
    }],
  },
});

/** agy's provider settings from `agy.toml`, in the app's config shape. */
const AGY_CONFIG = (Bun.TOML.parse(readFileSync(join(import.meta.dir, "agy.toml"), "utf8")) as {
  providers: { agy: { thinking: string; thinking_names: Record<string, string> } };
}).providers.agy;

/** The model variant for a thinking level, as the app's runner names it:
 *  the level's entry in `thinking_names`, else the level as written. The
 *  level `default` takes the provider's `thinking`. */
export function agyVariant(thinking: Thinking): string {
  const level = thinking === "default" ? AGY_CONFIG.thinking : thinking;
  return AGY_CONFIG.thinking_names[level] ?? level;
}

/** Google's Antigravity CLI, on the author's Google AI subscription. `model`
 *  is the family, such as `gemini-3.8-flash`; the thinking level picks the
 *  variant through `agyVariant`, because agy has no way to turn thinking off.
 *
 *  Every call runs in a fresh empty directory that agy treats as its
 *  workspace, as a custom agent with no tools, behind a hook that denies
 *  every tool. The prompt is an argument.
 *  `maxInFlight` bounds the calls across all drafts, because the drafts run
 *  side by side and each has its own limiter. */
export function agy(model: string, maxInFlight: number): Provider {
  const lim = limiter(maxInFlight);
  return {
    name: "agy",
    model,
    chat: (system, prompt, thinking, ceilingSecs) => lim(async () => {
      const dir = mkdtempSync(join(tmpdir(), "writegood-agy-"));
      try {
        agyWorkspace(dir);
        const t0 = performance.now();
        const proc = Bun.spawn([
          "agy", "-p", `${system}\n\n${prompt}`,
          "--agent", "writegood",
          "--model", `${model}-${agyVariant(thinking)}`,
          "--add-dir", dir,
          "--output-format", "json",
          "--print-timeout", `${ceilingSecs}s`,
        ], { cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const timer = setTimeout(() => proc.kill(), (ceilingSecs + 15) * 1000);
        const [out, err, code] = await Promise.all([
          new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
        ]);
        clearTimeout(timer);
        const agyError = err.split("\n").find((l) => l.startsWith("AGY_ERROR:"));
        if (code !== 0) throw new Error(`agy exited with ${code}: ${(agyError ?? err.trim()).slice(-300)}`);
        let j: any;
        try {
          j = JSON.parse(out);
        } catch {
          throw new Error(`agy did not print JSON: ${out.slice(0, 200)}`);
        }
        if (j.status !== "SUCCESS") throw new Error(`agy status ${j.status}: ${out.slice(0, 300)}`);
        if (j.denied_actions?.length) throw new Error(`agy tried a tool: ${JSON.stringify(j.denied_actions)}`);
        const u = j.usage ?? {};
        return {
          text: j.response ?? "",
          usage: {
            input: u.input_tokens ?? 0,
            cacheRead: u.cache_read_tokens ?? 0,
            output: (u.output_tokens ?? 0),
            reasoning: u.thinking_tokens ?? 0,
            cost: 0,
            costSource: "rates",
            servedBy: `agy ${model}-${agyVariant(thinking)}`,
            serviceSecs: (performance.now() - t0) / 1000,
          },
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
  };
}

// ---------------------------------------------------------------- result files

export interface CallRecord {
  draft: string;
  pass: string;
  /** "pass" for a pass call, "verify" for a verifier vote. */
  stage: "pass" | "verify";
  /** Paragraph index, or null for a document-scope call or a verifier. */
  chunk: number | null;
  thinking: Thinking;
  start: number;
  secs: number;
  input: number;
  cacheRead: number;
  output: number;
  reasoning: number;
  cost: number;
  costSource?: "reported" | "rates";
  servedBy?: string;
  serviceSecs?: number;
  /** Findings read from the reply, before filters and verifier. */
  candidates?: number;
  error?: string;
  unreadable?: string;
}

export interface Finding {
  draft: string;
  pass: string;
  quote: string;
  severity: string;
  note: string;
}

export interface DraftRecord {
  draft: string;
  words: number;
  paragraphs: number;
  /** Seconds from the first call to the last answer, verifiers included. */
  wall: number;
  /** Seconds until every pass that does not think has stored its findings. */
  firstFindings: number | null;
  calls: number;
  input: number;
  cacheRead: number;
  output: number;
  reasoning: number;
  cost: number;
  verifyCost: number;
  latency: { p50: number; p90: number; max: number };
  errors: number;
  unreadable: number;
  candidates: number;
  kept: number;
}

export interface Tally {
  tp: number;
  fp: number;
  fn: number;
  unanchored: number;
  decoy: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Result {
  schema: 1;
  label: string;
  date: string;
  source: string;
  config: {
    provider: string;
    /** OpenRouter: the upstream provider pinned for every call. */
    orProvider: string | null;
    model: string;
    thinking: Thinking;
    /** Passes run with their own thinking level (pipeline hybrid). */
    thinkingPasses: Record<string, Thinking>;
    pipeline: "plain" | "fast" | "hybrid";
    rules: string;
    scope: "native" | "document";
    limit: number;
    votes: number | null;
    need: number | null;
    ceilingSecs: number;
    /** OpenRouter: whether prompts carried cache_control breakpoints. */
    cacheControl?: boolean;
    drafts: string[];
    /** agy: calls in flight across all drafts. */
    agyLimit?: number;
    note?: string;
  };
  rules: string;
  drafts: DraftRecord[];
  scores: { overall: Tally; byPass: Record<string, Tally>; byDraft: Record<string, Tally> } | null;
  findings: Finding[];
  calls: CallRecord[];
  errors: string[];
}

export function quantiles(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0);
  return { p50: q(0.5), p90: q(0.9), max: s.at(-1) ?? 0 };
}
