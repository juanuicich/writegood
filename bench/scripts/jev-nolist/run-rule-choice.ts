/** Method 2 for word-level passes: find the sentence, then pick the quote.
 *
 *  Stage 1 is Method 1 unchanged: one Noul per sentence, with the pass's own
 *  rule text as the instructions (run-rule-noul.ts).
 *
 *  Stage 2 runs for each sentence that stage 1 kept. Code lists every span
 *  of one to eight consecutive words of the sentence (Intl.Segmenter, word
 *  granularity). One Choice question asks which span is exactly the text
 *  the rule says to quote. The chosen span is the quote. A sentence can hold
 *  more than one problem, so up to three more rounds follow. Each later round
 *  names the quotes already chosen, drops the spans that overlap them, and
 *  adds a "none" option. A round that picks "none" ends the sentence.
 *
 *  No word list, suffix pattern or English-only code decides what is
 *  flagged. Code only segments, lists spans and removes overlaps. The limit
 *  of eight words bounds the length of a quote, not what is flagged; the
 *  filler-words rule itself caps a stock phrase at about eight words. A
 *  sentence with too many spans for one Choice (255 options) gets a lower
 *  limit.
 *
 *  bun bench/scripts/jev-nolist/run-rule-choice.ts --label choice-fw-1 \
 *    --passes filler-words --keep 0.5 [--drafts a.md,b.md] [--rules NAME]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paragraphs } from "../../../src/lib/passes/parse";
import { limiter } from "../../../src/lib/passes/limit";
import { draftPath, flag, quantiles, RESULTS, SCORED, words, type CallRecord, type DraftRecord, type Finding } from "../lib";
import { describe, passesRun, score } from "../score";
import { sentencesOf, wordsOf, type Span } from "./segment";
import { ruleText } from "./rule-text";
import { askJev, checkBudget, totalCalls, totalCost, type ChoiceQuestion, type NoulQuestion, type Question } from "./jev-client";

const label = flag("--label");
const drafts = (flag("--drafts") ?? SCORED.join(",")).split(",");
const passSlugs = (flag("--passes") ?? "filler-words,passive-actor").split(",");
const ruleSet = flag("--rules", "2026-09-23-rewrite")!;
const budget = Number(flag("--budget", "2"));
const ceiling = Number(flag("--ceiling", "60"));
const keepThreshold = Number(flag("--keep", "0.45"));
const maxSpan = Number(flag("--max-span", "8"));
const rounds = Number(flag("--rounds", "4"));
const date = new Date().toISOString().slice(0, 10);
if (!label) throw new Error("--label is required");
const outFile = join(RESULTS, `${date}-${label}.json`);
if (existsSync(outFile) && !process.argv.includes("--force")) throw new Error(`${outFile} exists; pick another --label or pass --force`);

const MAX_OPTIONS = 250;

function severity(p: number): "low" | "medium" | "high" {
  if (p >= 0.85) return "high";
  if (p >= 0.65) return "medium";
  return "low";
}

/** Stage 1: the Method 1 question, word for word. */
function detect(rule: string, paragraph: string, sentence: string): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      rule,
      paragraph,
      sentence,
      question:
        "`rule` defines a specific problem an editor looks for in a piece of writing, written for a human editor to apply. " +
        "Read `sentence`, using `paragraph` only for surrounding context. Does `sentence` itself show that problem, per " +
        "`rule`? Answer yes only when `sentence`, not merely the paragraph around it, does what `rule` says to flag, and " +
        "apply every exclusion `rule` itself lists.",
    },
    criteria: {
      true: "`sentence` itself does what `rule` says to flag.",
      false: "`sentence` does not — including every case `rule`'s own exclusions name.",
    },
  };
}

/** Every span of one to `limit` consecutive words, as [first word, last word]. */
function spans(ws: Span[], limit: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ws.length; i++) for (let j = i; j < Math.min(ws.length, i + limit); j++) out.push([i, j]);
  return out;
}

/** Stage 2, one round: which span is the quote the rule asks for. */
function pick(rule: string, sentence: string, options: Record<string, string>, already: string[]): ChoiceQuestion {
  const first = already.length === 0;
  return {
    type: "choice",
    instructions: {
      rule,
      sentence,
      ...(first ? {} : { already_quoted: already }),
      question:
        "`sentence` shows the problem that `rule` defines. `rule` also says which words to quote for one instance of " +
        "that problem. Each option is a span of consecutive words from `sentence`. Which option is exactly the text " +
        "`rule` says to quote: all of it, and nothing more?" +
        (first
          ? ""
          : " The instances in `already_quoted` are already reported. Pick a span for a different instance of the " +
            "problem in `sentence`, or `none` if `sentence` has no other instance."),
    },
    criteria: {
      ...options,
      ...(first ? {} : { none: "`sentence` has no other instance of the problem beyond `already_quoted`." }),
    },
  };
}

const lim = limiter(8);

async function runDraft(name: string) {
  const draft = readFileSync(draftPath(name), "utf8");
  const paras = paragraphs(draft);
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const calls: CallRecord[] = [];
  const findings: Finding[] = [];
  let candidates = 0;

  const ask = async (slug: string, chunk: number, state: string, questions: Record<string, Question>) => {
    checkBudget(budget);
    const rec: CallRecord = {
      draft: name, pass: slug, stage: "pass", chunk, thinking: "default", start: now(), secs: 0,
      input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0, costSource: "reported", servedBy: "jev",
    };
    calls.push(rec);
    return lim(async () => {
      try {
        const { answers, usage, secs } = await askJev(state, questions, ceiling);
        Object.assign(rec, { secs, input: usage.inputTokens, output: usage.outputTokens, cost: usage.cost });
        rec.candidates = Object.keys(questions).length;
        return answers;
      } catch (e) {
        rec.error = e instanceof Error ? e.message : String(e);
        rec.secs = now() - rec.start;
        return null;
      }
    });
  };

  const locate = async (slug: string, rule: string, chunk: number, para: string, sentence: Span, p: number) => {
    const ws = wordsOf(sentence.text);
    if (!ws.length) return;
    let limit = maxSpan;
    while (limit > 1 && spans(ws, limit).length > MAX_OPTIONS) limit--;
    let all = spans(ws, limit);
    if (all.length > MAX_OPTIONS) all = all.slice(0, MAX_OPTIONS);
    const chosen: [number, number][] = [];
    const quotes: string[] = [];
    for (let round = 0; round < rounds; round++) {
      const open = all.filter(([a, b]) => !chosen.some(([c, d]) => a <= d && c <= b));
      if (!open.length) break;
      const options: Record<string, string> = {};
      for (const [a, b] of open) options[`${a}-${b}`] = sentence.text.slice(ws[a]!.from, ws[b]!.to);
      const answers = await ask(slug, chunk, para, { quote: pick(rule, sentence.text, options, quotes) });
      const a = answers?.quote;
      if (!a || a.type !== "choice" || a.choice === "none" || !(a.choice in options)) break;
      const [from, to] = a.choice.split("-").map(Number) as [number, number];
      chosen.push([from, to]);
      const quote = options[a.choice]!;
      quotes.push(quote);
      findings.push({
        draft: name, pass: slug, quote, severity: severity(p),
        note: `Matches the pass rule "${slug}" (Jev: sentence by Noul, quote by Choice over word spans, round ${round + 1}).`,
      });
    }
  };

  await Promise.all(
    paras.flatMap((para, chunk) =>
      passSlugs.map(async (slug) => {
        const rule = ruleText(slug, ruleSet);
        const sentences = sentencesOf(para);
        if (!sentences.length) return;
        candidates += sentences.length;
        const questions: Record<string, NoulQuestion> = {};
        sentences.forEach((s, i) => (questions[`q${i}`] = detect(rule, para, s.text)));
        const answers = await ask(slug, chunk, para, questions);
        if (!answers) return;
        await Promise.all(sentences.map((s, i) => {
          const a = answers[`q${i}`];
          if (a?.type !== "noul" || a.noul < keepThreshold) return;
          return locate(slug, rule, chunk, para, s, a.noul);
        }));
      }),
    ),
  );

  const wall = now();
  const record: DraftRecord = {
    draft: name,
    words: words(draft),
    paragraphs: paras.length,
    wall,
    firstFindings: wall,
    calls: calls.length,
    input: calls.reduce((n, c) => n + c.input, 0),
    cacheRead: 0,
    output: calls.reduce((n, c) => n + c.output, 0),
    reasoning: 0,
    cost: calls.reduce((n, c) => n + c.cost, 0),
    verifyCost: 0,
    latency: quantiles(calls.map((c) => c.secs)),
    errors: calls.filter((c) => c.error).length,
    unreadable: 0,
    candidates,
    kept: findings.length,
  };
  return { record, calls, findings };
}

const runs = await Promise.all(drafts.map(runDraft));
const calls = runs.flatMap((r) => r.calls);
const findings = runs.flatMap((r) => r.findings);
const result = {
  schema: 1 as const,
  label,
  date,
  source: "bench/scripts/jev-nolist/run-rule-choice.ts",
  config: {
    provider: "jev",
    orProvider: null,
    model: "jev-latest",
    thinking: "default" as const,
    thinkingPasses: {},
    pipeline: "plain" as const,
    rules: `${ruleSet} (verbatim, sentence Noul then span Choice)`,
    scope: "native" as const,
    limit: 8,
    votes: null,
    need: null,
    ceilingSecs: ceiling,
    drafts,
    note:
      `Method 2 (rule-as-criterion, Choice-located quote): one Noul per sentence, then up to ${rounds} Choice rounds ` +
      `over spans of 1-${maxSpan} words. Passes: ${passSlugs.join(", ")}. Keep >= ${keepThreshold}.`,
  },
  rules: "jev-nolist-method2",
  drafts: runs.map((r) => r.record),
  scores: null as any,
  findings,
  calls,
  errors: [...new Set(calls.flatMap((c) => (c.error ? [c.error] : [])))].map((e) => e.slice(0, 300)),
};
result.scores = score(findings, passesRun(result as any)).scores;

mkdirSync(RESULTS, { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 1));

for (const d of result.drafts) {
  console.log(
    `  ${d.draft.padEnd(16)} wall ${d.wall.toFixed(1).padStart(6)}s  ${String(d.calls).padStart(3)} calls  ` +
      `$${d.cost.toFixed(5)}  kept ${d.kept} of ${d.candidates} sentences  errors ${d.errors}`,
  );
}
if (result.scores) console.log(describe(label, result.scores, true));
console.log(`Jev spend this run: $${totalCost.toFixed(5)} over ${totalCalls} requests`);
console.log(`wrote ${outFile}`);
