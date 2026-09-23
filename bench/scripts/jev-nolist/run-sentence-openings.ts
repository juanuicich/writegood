/** Method 2: sentence-openings with no marker word list at all — not even
 *  the closed set of English subordinators ("after", "when", "since"...)
 *  the plain-code variant in bench/scripts/jev/candidates.ts needed. That
 *  list is exactly the kind of thing Juan asked to remove: it silently
 *  assumes English.
 *
 *  Two problems, two Jev-driven procedures, both usable on any language
 *  Intl.Segmenter can split into sentences and words:
 *
 *  Run (three or more consecutive sentences with the same opening):
 *   1. One Noul per paragraph, rule text plus the paragraph's own sentences
 *      as state — "is there a run in here at all?"
 *   2. If yes, one Choice over the paragraph's sentences (each one an
 *      option, its own text as the option's description) — "which sentence
 *      starts it?"
 *   3. A batch of Nouls, one per later sentence — "does this one open the
 *      same way as the first?" — and code counts the consecutive yeses.
 *      That count is bookkeeping on Jev's own pairwise judgments, not a
 *      rule about which words matter.
 *
 *  Late subject (ten-plus words before the sentence's real subject):
 *   1. One Noul per sentence — "is the subject unusually delayed here?"
 *   2. If yes, one Choice over the sentence's own words (Intl.Segmenter,
 *      word granularity) — "which word is the subject?" The quote is
 *      everything before that word; the word count feeding the rule's own
 *      numeric severity bands (11–15 / 16–25 / >25) is Intl.Segmenter
 *      counting a span Jev already chose, not a decision about content.
 *
 *  bun bench/scripts/jev-nolist/run-sentence-openings.ts --label so-v1 [--drafts a.md,b.md] [--rules NAME]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paragraphs } from "../../../src/lib/passes/parse";
import { draftPath, flag, quantiles, RESULTS, SCORED, words, type CallRecord, type DraftRecord, type Finding } from "../lib";
import { describe, passesRun, score } from "../score";
import { sentencesOf, wordsOf, wordsBefore } from "./segment";
import { ruleText } from "./rule-text";
import { askJev, checkBudget, totalCalls, totalCost, type Question } from "./jev-client";

const label = flag("--label", `so-${new Date().toISOString().slice(0, 10)}`)!;
const drafts = (flag("--drafts") ?? SCORED.join(",")).split(",");
const budget = Number(flag("--budget", "5"));
const ceiling = Number(flag("--ceiling", "60"));
// 0.5 is the textbook keep threshold. Every pass probed in this benchmark —
// list-based and rule-text-based alike — put a real, gold-listed hit at
// 0.42-0.49 at least once. 0.45 is the compromise used throughout.
const keepThreshold = Number(flag("--keep", "0.45"));
const date = new Date().toISOString().slice(0, 10);
const outFile = join(RESULTS, `${date}-${label}.json`);
if (existsSync(outFile) && !process.argv.includes("--force")) throw new Error(`${outFile} exists; pick another --label or pass --force`);

const ruleSet = flag("--rules", "2026-09-23-rewrite")!;
const RULE = ruleText("sentence-openings", ruleSet);
const SLUG = "sentence-openings";

interface Ctx {
  para: string;
  draft: string;
  chunk: number;
  calls: CallRecord[];
  findings: Finding[];
  candidates: number;
  now: () => number;
}

async function ask(ctx: Ctx, questions: Record<string, Question>, ceilingSecs: number) {
  checkBudget(budget);
  const rec: CallRecord = {
    draft: ctx.draft, pass: SLUG, stage: "pass", chunk: ctx.chunk, thinking: "default", start: ctx.now(), secs: 0,
    input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0, costSource: "reported", servedBy: "jev",
  };
  ctx.calls.push(rec);
  try {
    const { answers, usage, secs } = await askJev(ctx.para, questions, ceilingSecs);
    rec.secs = secs;
    rec.input = usage.inputTokens;
    rec.output = usage.outputTokens;
    rec.cost = usage.cost;
    rec.candidates = Object.keys(questions).length;
    return answers;
  } catch (e) {
    rec.error = e instanceof Error ? e.message : String(e);
    rec.secs = ctx.now() - rec.start;
    return null;
  }
}

async function checkRun(ctx: Ctx, sentences: { text: string; from: number; to: number }[]) {
  if (sentences.length < 3) return;
  ctx.candidates += 1;
  const detect = await ask(ctx, {
    hasRun: {
      type: "noul",
      instructions: {
        rule: RULE,
        sentences: sentences.map((s) => s.text),
        question:
          "`rule` describes two problems with how a paragraph's sentences open: a run of sentences sharing the same " +
          "opening, and a sentence whose subject is unusually delayed. Using only `sentences`, listed in order, does " +
          "this paragraph contain a run of three or more CONSECUTIVE sentences that open with the same words or the " +
          "same construction, per `rule`'s run problem? Ignore the late-subject problem for this question.",
      },
      criteria: {
        true: "Three or more sentences in a row, from `sentences`, share an opening or construction, per `rule`.",
        false: "No such run exists, including the cases `rule` itself excludes (sharing only a one-word article or pronoun, an announced list, deliberate parallel structure).",
      },
    },
  }, ceiling);
  if (!detect || detect.hasRun?.type !== "noul" || detect.hasRun.noul < keepThreshold) return;

  const options: Record<string, unknown> = {};
  sentences.forEach((s, i) => (options[String(i)] = s.text));
  const locate = await ask(ctx, {
    start: {
      type: "choice",
      instructions: {
        rule: RULE,
        sentences: sentences.map((s) => s.text),
        question: "Which sentence in `sentences` is the FIRST sentence of the repeated-opening run described in `rule`?",
      },
      criteria: options,
    },
  }, ceiling);
  if (!locate || locate.start?.type !== "choice") return;
  const startIdx = Number(locate.start.choice);
  if (!Number.isInteger(startIdx) || startIdx < 0 || startIdx >= sentences.length - 2) return;

  const rest = sentences.slice(startIdx + 1);
  if (!rest.length) return;
  const pairs: Record<string, Question> = {};
  rest.forEach((s, i) => {
    pairs[`p${i}`] = {
      type: "noul",
      instructions: {
        rule: RULE,
        first: sentences[startIdx]!.text,
        next: s.text,
        question: "Does `next` open with the same words or the same construction as `first`, per `rule`'s run problem?",
      },
      criteria: {
        true: "`next` opens the same way as `first` — the same words, or the same grammatical construction.",
        false: "`next` opens differently from `first`.",
      },
    };
  });
  const chain = await ask(ctx, pairs, ceiling);
  if (!chain) return;
  let runLen = 1;
  for (let i = 0; i < rest.length; i++) {
    const p = chain[`p${i}`];
    if (p?.type === "noul" && p.noul >= 0.5) runLen++;
    else break;
  }
  if (runLen < 3) return;
  const first = sentences[startIdx]!;
  ctx.findings.push({
    draft: ctx.draft, pass: SLUG, quote: first.text, severity: runLen >= 4 ? "high" : "medium",
    note: `Repeated opening across ${runLen} consecutive sentences (Jev, no marker list).`,
  });
}

async function checkLateSubject(ctx: Ctx, sentence: { text: string; from: number; to: number }) {
  ctx.candidates += 1;
  const detect = await ask(ctx, {
    late: {
      type: "noul",
      instructions: {
        rule: RULE,
        sentence: sentence.text,
        question:
          "`rule` describes two problems with how a paragraph's sentences open: a run of repeated openings, and a " +
          "sentence whose subject is unusually delayed behind a long introductory phrase or clause. Does `sentence` " +
          "show the second problem — more than ten words before its main grammatical subject, per `rule`? Ignore the " +
          "run problem for this question.",
      },
      criteria: {
        true: "`sentence`'s main subject arrives unusually late, behind a long introductory phrase or clause, per `rule`.",
        false: "The subject is not unusually delayed, including any case `rule` itself excludes (a short introductory phrase, an announced list, headings, quotations).",
      },
    },
  }, ceiling);
  if (!detect || detect.late?.type !== "noul" || detect.late.noul < keepThreshold) return;

  const wordSpans = wordsOf(sentence.text);
  if (wordSpans.length < 3) return;
  const options: Record<string, unknown> = {};
  wordSpans.forEach((w, i) => (options[String(i)] = w.text));
  const locate = await ask(ctx, {
    subject: {
      type: "choice",
      instructions: {
        sentence: sentence.text,
        question:
          "Which word in `sentence`, listed in `words` by index, is the sentence's main grammatical subject — the " +
          "word or short phrase the sentence is fundamentally about, that performs or undergoes the sentence's main " +
          "action?",
        words: wordSpans.map((w) => w.text),
      },
      criteria: options,
    },
  }, ceiling);
  if (!locate || locate.subject?.type !== "choice") return;
  const idx = Number(locate.subject.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= wordSpans.length) return;
  const subjectWord = wordSpans[idx]!;
  const n = wordsBefore(sentence.text, subjectWord.from);
  if (n <= 10) return;
  const severity = n > 25 ? "high" : n >= 16 ? "medium" : "low";
  const quote = sentence.text.slice(0, subjectWord.from).trim();
  if (!quote) return;
  ctx.findings.push({
    draft: ctx.draft, pass: SLUG, quote,
    severity, note: `${n} words come before the sentence's subject (Jev located the subject, no marker list).`,
  });
}

async function runDraft(name: string) {
  const draft = readFileSync(draftPath(name), "utf8");
  const paras = paragraphs(draft);
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const calls: CallRecord[] = [];
  const findings: Finding[] = [];
  let candidates = 0;

  await Promise.all(
    paras.map(async (para, chunk) => {
      const sentences = sentencesOf(para);
      if (!sentences.length) return;
      const ctx: Ctx = { para, draft: name, chunk, calls, findings, candidates: 0, now };
      await Promise.all([checkRun(ctx, sentences), ...sentences.map((s) => checkLateSubject(ctx, s))]);
      candidates += ctx.candidates;
    }),
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
  source: "bench/scripts/jev-nolist/run-sentence-openings.ts",
  config: {
    provider: "jev",
    orProvider: null,
    model: "jev-latest",
    thinking: "default" as const,
    thinkingPasses: {},
    pipeline: "plain" as const,
    rules: `${ruleSet} (verbatim) via Choice-located spans`,
    scope: "native" as const,
    limit: 8,
    votes: null,
    need: null,
    ceilingSecs: ceiling,
    drafts,
    note: "Method 2: Jev Choice locates the run's start sentence and the late subject's word; no marker word list.",
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
      `$${d.cost.toFixed(5)}  kept ${d.kept} of ${d.candidates}  errors ${d.errors}`,
  );
}
if (result.scores) console.log(describe(label, result.scores, true));
console.log(`Jev spend this run: $${totalCost.toFixed(5)} over ${totalCalls} requests`);
console.log(`wrote ${outFile}`);
