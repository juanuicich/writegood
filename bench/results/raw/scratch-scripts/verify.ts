/** Second stage: check a run's candidate findings against each pass's rule,
 *  one call per pass per draft, and keep only what the verifier accepts.
 *
 *  Usage: bun verify.ts in.json out.json [--model M] [--thinking on|off]
 *         [--effort low|high] [--prompt strict|plain]
 *
 *  Adds verifier time and cost to each draft: wall grows by the slowest
 *  verifier call of that draft, since all of them run at once. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "<repo>";
const { extractArray } = await import(`${REPO}/src/lib/passes/parse`);
const S = "<scratch>";
const HOME = join(homedir(), ".writegood");
const flag = (n: string, d?: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const [, , inFile, outFile] = process.argv;
const model = flag("--model", "deepseek-flash")!;
const thinking = flag("--thinking", "off") === "on";
const effort = flag("--effort");
const style = flag("--prompt", "strict")!;
const votes = Number(flag("--votes", "1"));
const each = process.argv.includes("--each");
const need = Number(flag("--need", String(Math.ceil((votes + 1) / 2))));
const passDir = flag("--passes", join(HOME, "passes"))!;
const RATES: Record<string, { input: number; cache: number; output: number }> = {
  "deepseek-flash": { input: 0.15, cache: 0.003, output: 0.6 },
  "deepseek-v4-pro": { input: 0.435, cache: 0.003625, output: 0.87 },
};
const rates = RATES[model]!;
const KEY = readFileSync(join(HOME, ".env"), "utf8").match(/^DEEPSEEK_API_KEY=(.*)$/m)![1]!.trim().replace(/^["']|["']$/g, "");

const rules = new Map<string, string>();
for (const file of readdirSync(passDir).filter((f) => f.endsWith(".md"))) {
  const parts = readFileSync(join(passDir, file), "utf8").split(/^\+\+\+$/m);
  const cat = parts[1]!.match(/^\s*category\s*=\s*"([^"]+)"/m)![1]!;
  rules.set(cat, parts.slice(2).join("+++").trim());
}

const SYSTEM = `You are a senior copyeditor checking another editor's findings. You accept a finding only when it clearly meets the rule. You never rewrite the draft.`;

function prompt(draft: string, rule: string, cands: { quote: string; note: string }[]) {
  const list = cands.map((c, i) => `${i + 1}. quote: ${JSON.stringify(c.quote)}\n   note: ${JSON.stringify(c.note)}`).join("\n");
  const how = style === "strict"
    ? `For each candidate, apply the rule exactly, including its "Do not flag" list. Keep it only if a careful editor applying this rule would report it. Drop it if any of these hold:
- it does not meet the rule's test, or the rule says not to flag it
- it belongs to a different kind of problem than this rule covers
- its note says there is no problem, or hedges about whether there is one
- it repeats an earlier candidate about the same words
When in doubt, drop it.`
    : style === "balanced"
    ? `For each candidate, apply the rule exactly, including its "Do not flag" list. Keep it if a careful editor applying this rule would report it. Drop it if it fails the rule's test, if the rule says not to flag it, if it belongs to a different kind of problem, if its note says there is no problem, or if it repeats an earlier candidate about the same words.`
    : `For each candidate, decide whether it meets the rule. Keep it if it does.`;
  return `--- the draft ---\n${draft}\n\n--- the rule ---\n${rule}\n\n--- candidates ---\n${list}\n\n--- the task ---\n${how}\n\nReply as JSON: an array with one item per candidate, {"id": <number>, "keep": true or false}.`;
}

async function ask(p: string) {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: p }],
    thinking: { type: thinking ? "enabled" : "disabled" },
  };
  if (thinking && effort) body.reasoning_effort = effort;
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(100_000),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

const run = JSON.parse(readFileSync(inFile!, "utf8"));
const draftPath = (d: string) => [join(S, "eval", d), join(S, d), join(HOME, "documents", d)].find(existsSync)!;
let kept = 0, total = 0, failures = 0;
await Promise.all(run.results.map(async (r: any) => {
  const draft = readFileSync(draftPath(r.draft), "utf8");
  const byPass = new Map<string, any[]>();
  for (const c of r.calls) for (const f of c.findings) byPass.set(c.pass, [...(byPass.get(c.pass) ?? []), f]);
  const t0 = Date.now();
  let cost = 0;
  const keepSets = new Map<string, Set<any>>();
  if (each) {
    // One call per candidate, each asked on its own; `votes` calls per
    // candidate, kept with `need` keeps.
    await Promise.all([...byPass].map(async ([pass, cands]) => {
      const keep = new Set<any>();
      await Promise.all(cands.map(async (c) => {
        let yes = 0, answered = 0;
        await Promise.all(Array.from({ length: votes }, async () => {
          try {
            const j = await ask(prompt(draft, rules.get(pass)!, [c]));
            const u = j.usage;
            const hit = u.prompt_cache_hit_tokens ?? 0;
            cost += ((u.prompt_tokens - hit) * rates.input + hit * rates.cache + u.completion_tokens * rates.output) / 1e6;
            const m = (j.choices[0].message.content ?? "").match(/"keep"\s*:\s*(true|false)/);
            if (!m) throw new Error("no keep");
            answered++;
            if (m[1] === "true") yes++;
          } catch (e) {
            failures++;
            if (process.env.DEBUG) console.error(`${r.draft} ${pass}: ${String(e).slice(0, 200)}`);
          }
        }));
        if (answered === 0 || yes >= Math.min(need, answered)) keep.add(c);
      }));
      keepSets.set(pass, keep);
    }));
  } else
  await Promise.all([...byPass].map(async ([pass, cands]) => {
    // Several verifiers vote at once; a candidate stays with `need` keeps.
    const tally = new Map<any, number>();
    let answered = 0;
    await Promise.all(Array.from({ length: votes }, async () => {
      try {
        const j = await ask(prompt(draft, rules.get(pass)!, cands));
        const u = j.usage;
        const hit = u.prompt_cache_hit_tokens ?? 0;
        cost += ((u.prompt_tokens - hit) * rates.input + hit * rates.cache + u.completion_tokens * rates.output) / 1e6;
        const content: string = j.choices[0].message.content ?? "";
        const raw = extractArray(content);
        // With one candidate the verifier often answers with a bare object.
        const one = raw === null ? content.match(/\{[^{}]*"keep"[^{}]*\}/)?.[0] : undefined;
        if (raw === null && !one) throw new Error("no array: " + content.slice(0, 600));
        for (const x of raw !== null ? JSON.parse(raw) : [JSON.parse(one!)]) {
          const c = x && x.keep === true ? cands[Number(x.id) - 1] : undefined;
          if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
        }
        answered++;
      } catch (e) {
        failures++;
        if (process.env.DEBUG) console.error(`${r.draft} ${pass}: ${String(e).slice(0, 300)}`);
      }
    }));
    // No verifier answered: keep everything rather than lose the pass.
    if (answered === 0) keepSets.set(pass, new Set(cands));
    else keepSets.set(pass, new Set(cands.filter((c) => (tally.get(c) ?? 0) >= Math.min(need, answered))));
  }));
  for (const c of r.calls) {
    total += c.findings.length;
    const keep = keepSets.get(c.pass);
    if (keep) c.findings = c.findings.filter((f: any) => keep.has(f));
    kept += c.findings.length;
  }
  r.verifyWall = (Date.now() - t0) / 1000;
  r.verifyCost = cost;
  r.wall += r.verifyWall;
}));
run.label += ` +verify(${model} ${thinking ? effort ?? "high" : "off"} ${style}${votes > 1 ? ` ${need}/${votes}` : ""}${each ? " each" : ""})`;
writeFileSync(outFile!, JSON.stringify(run));
console.log(run.label);
for (const r of run.results) {
  const gen = r.calls.reduce((n: number, c: any) => n + c.cost, 0);
  console.log(`  ${r.draft.padEnd(16)} wall ${r.wall.toFixed(1)}s (verify ${r.verifyWall.toFixed(1)}s)  cost $${(gen + r.verifyCost).toFixed(4)} (verify $${r.verifyCost.toFixed(4)})`);
}
console.log(`  kept ${kept} of ${total}, ${failures} failed checks`);
