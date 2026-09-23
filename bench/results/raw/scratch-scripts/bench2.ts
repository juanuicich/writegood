/** Experiment harness: run every enabled pass over one or more drafts against
 *  DeepSeek, with knobs the app does not expose yet.
 *
 *  Prompts: the app's preamble and buildPrompt. Replies: the app's parser.
 *  Calls: direct HTTPS to DeepSeek, with the app's 100 s ceiling. Cost: the
 *  models.dev rates the app uses (prices.rs), cache reads at their own rate.
 *
 *  --model deepseek-flash|deepseek-v4-pro
 *  --thinking on|off          (default on)
 *  --effort low|high|max      (thinking on only)
 *  --scope native|document    document: every pass sends the whole draft once
 *  --order fifo|docfirst      docfirst: document-scope calls go to the front
 *  --limit N                  calls in flight per draft (default 8)
 *  --passes DIR               default ~/.writegood/passes
 *  --drafts a.md,b.md
 *  --out FILE                 every call, with its findings, as JSON
 *  --severity strict|lenient  lenient maps moderate→medium, minor→low, etc.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const REPO = "<repo>";
const { preamble } = await import(`${REPO}/src/lib/passes/schema`);
const { buildPrompt, paragraphs, parseFindings } = await import(`${REPO}/src/lib/passes/parse`);
const HOME = join(homedir(), ".writegood");

const flag = (n: string, d?: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const model = flag("--model", "deepseek-flash")!;
const thinking = flag("--thinking", "on") === "on";
const effort = flag("--effort");
const scope = flag("--scope", "native")!;
const order = flag("--order", "fifo")!;
const limit = Number(flag("--limit", "8"));
const passDir = flag("--passes", join(HOME, "passes"))!;
const drafts = flag("--drafts", join(HOME, "documents", "on-writing.md"))!.split(",");
const out = flag("--out");
const lenient = flag("--severity", "strict") === "lenient";
const CEILING = Number(flag("--ceiling", "100")) * 1000;

const RATES: Record<string, { input: number; cache: number; output: number }> = {
  "deepseek-flash": { input: 0.15, cache: 0.003, output: 0.6 },
  "deepseek-v4-pro": { input: 0.435, cache: 0.003625, output: 0.87 },
};
const rates = RATES[model]!;

const env = readFileSync(join(HOME, ".env"), "utf8");
const KEY = env.match(/^DEEPSEEK_API_KEY=(.*)$/m)![1]!.trim().replace(/^["']|["']$/g, "");

function loadPasses() {
  return readdirSync(passDir).filter((f) => f.endsWith(".md")).sort().flatMap((file) => {
    const text = readFileSync(join(passDir, file), "utf8");
    const parts = text.split(/^\+\+\+$/m);
    const meta = parts[1]!;
    const field = (k: string) => meta.match(new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\n]+)"?\\s*$`, "m"))?.[1];
    if (field("enabled") === "false") return [];
    return [{
      slug: field("category") ?? file,
      name: field("name") ?? file,
      category: field("category") ?? file,
      scope: (field("scope") ?? "paragraph") as "paragraph" | "document",
      provider: null,
      enabled: true,
      prompt: parts.slice(2).join("+++").trim(),
      path: join(passDir, file),
    }];
  });
}

const SEV: Record<string, string> = { moderate: "medium", minor: "low", major: "high", critical: "high", severe: "high" };
function relax(text: string): string {
  return text.replace(/("severity"\s*:\s*")([A-Za-z]+)(")/g, (_m, a, s: string, b) => a + (SEV[s.toLowerCase()] ?? s.toLowerCase()) + b);
}

function limiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((r) => waiting.push(r));
    else running += 1;
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}

interface Call {
  draft: string; pass: string; chunk: number; start: number; secs: number;
  input: number; cacheRead: number; output: number; reasoning: number; cost: number;
  findings: { quote: string; severity: string; note: string }[];
  error?: string; reply?: string;
}

const system = (runId: string) => `Run ${runId}.\n\n${preamble({ allowSuggestions: false, redactSuggestions: true, forbidPraise: true, blindJudge: true })}`;

async function ask(sys: string, prompt: string): Promise<{ text: string; usage: any }> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
    thinking: { type: thinking ? "enabled" : "disabled" },
  };
  if (thinking && effort) body.reasoning_effort = effort;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CEILING);
  try {
    const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return { text: j.choices[0].message.content ?? "", usage: j.usage };
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(`did not answer within ${CEILING / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function runDraft(path: string, passes: ReturnType<typeof loadPasses>) {
  const draft = readFileSync(path, "utf8");
  const sys = system(crypto.randomUUID());
  const t0 = Date.now();
  const lim = limiter(limit);
  const jobs: { pass: (typeof passes)[number]; chunk: string | null; i: number; doc: boolean }[] = [];
  for (const p of passes) {
    const doc = scope === "document" || p.scope === "document";
    const chunks = doc ? [null] : paragraphs(draft);
    chunks.forEach((c, i) => jobs.push({ pass: p, chunk: c, i, doc }));
  }
  if (order === "docfirst") jobs.sort((a, b) => Number(b.doc) - Number(a.doc));
  const calls = await Promise.all(jobs.map((j) => lim(async (): Promise<Call> => {
    const start = Date.now();
    const call: Call = {
      draft: basename(path), pass: j.pass.slug, chunk: j.i, start: (start - t0) / 1000, secs: 0,
      input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0, findings: [],
    };
    try {
      const { text, usage } = await ask(sys, buildPrompt(j.pass, draft, j.chunk));
      call.input = usage.prompt_tokens ?? 0;
      call.cacheRead = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
      call.output = usage.completion_tokens ?? 0;
      call.reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;
      call.cost = ((call.input - call.cacheRead) * rates.input + call.cacheRead * rates.cache + call.output * rates.output) / 1e6;
      call.reply = text;
      try {
        call.findings = parseFindings(lenient ? relax(text) : text, "deepseek").map((f: any) => ({ quote: f.quote, severity: f.severity, note: f.note }));
      } catch (e) {
        call.error = String(e);
      }
    } catch (e) {
      call.error = String(e);
    }
    call.secs = (Date.now() - start) / 1000;
    return call;
  })));
  return { draft: basename(path), wall: (Date.now() - t0) / 1000, calls };
}

const passes = loadPasses();
const results = await Promise.all(drafts.map((d) => runDraft(d, passes)));

const label = `${model} thinking=${thinking ? effort ?? "high" : "off"} scope=${scope} order=${order} limit=${limit}${lenient ? " lenient" : ""}`;
console.log(label);
for (const r of results) {
  const cs = r.calls;
  const sum = (f: (c: Call) => number) => cs.reduce((n, c) => n + f(c), 0);
  const lat = cs.map((c) => c.secs).sort((a, b) => a - b);
  const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]!;
  console.log(
    `  ${r.draft.padEnd(16)} wall ${r.wall.toFixed(1).padStart(6)}s  ${String(cs.length).padStart(3)} calls  p50 ${q(0.5).toFixed(1)}s p90 ${q(0.9).toFixed(1)}s  ` +
      `in ${sum((c) => c.input)} (cache ${sum((c) => c.cacheRead)}) out ${sum((c) => c.output)}  $${sum((c) => c.cost).toFixed(4)}  ` +
      `findings ${sum((c) => c.findings.length)}  errors ${cs.filter((c) => c.error).length}`,
  );
}
if (out) writeFileSync(out, JSON.stringify({ label, model, thinking, effort, scope, order, limit, lenient, results }, null, 2));
