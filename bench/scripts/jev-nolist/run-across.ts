/** Method `across` from SPEC §8.4, for a rule whose problem can lie across
 *  sentences. Sentence openings is the pass it is for.
 *
 *  Part 1 is method `sentence` (Method 2, run-rule-choice.ts) unchanged:
 *  one Noul per sentence with the rule text, then up to four Choice rounds
 *  over the sentence's word spans.
 *
 *  Part 2 runs for each paragraph of two or more sentences:
 *   1. Detect. One Noul with the rule text and the paragraph's sentences in
 *      order. It asks whether the problem lies across two or more of the
 *      sentences, in a way that no single sentence shows.
 *   2. Choose the sentence. One Choice whose options are the sentences. It
 *      asks which sentence holds the text the rule says to quote.
 *   3. Locate. One Choice over the spans of that sentence.
 *
 *  In this method every Choice over spans lists every span of one to eight
 *  words, and also every span that starts at the sentence's first word, at
 *  any length. The code offers positions. The rule text chooses among them.
 *
 *  The questions are generic: they name the rule, not any problem the rule
 *  describes. Code only segments with Intl.Segmenter, lists sentences and
 *  spans, turns a chosen option into a quote and removes a span that
 *  overlaps one already chosen. No word list, pattern or count decides what
 *  is flagged.
 *
 *  bun bench/scripts/jev-nolist/run-across.ts --label jev-across-1 \
 *    [--passes sentence-openings] [--rules NAME] [--keep 0.45] [--drafts a.md,b.md]
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
const passSlugs = (flag("--passes") ?? "sentence-openings").split(",");
const ruleSet = flag("--rules", "2026-09-23-rewrite")!;
const budget = Number(flag("--budget", "1"));
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

/** Method `sentence`, detect: the question of run-rule-choice.ts, word for word. */
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

/** Method `across`, detect: does the problem lie across sentences. */
function detectAcross(rule: string, sentences: string[]): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      rule,
      sentences,
      question:
        "`rule` defines a specific problem an editor looks for in a piece of writing, written for a human editor to apply. " +
        "`sentences` are the sentences of one paragraph, in order. Does that problem, per `rule`, lie across two or more " +
        "of `sentences`, in a way that no single sentence shows on its own? Apply every exclusion `rule` itself lists.",
    },
    criteria: {
      true: "The problem that `rule` defines lies across two or more of `sentences`.",
      false: "It does not — including every case `rule`'s own exclusions name.",
    },
  };
}

/** Method `across`, step 2: which sentence holds the quote. */
function chooseSentence(rule: string, sentences: string[]): ChoiceQuestion {
  const criteria: Record<string, string> = {};
  sentences.forEach((s, i) => (criteria[`s${i}`] = s));
  return {
    type: "choice",
    instructions: {
      rule,
      sentences,
      question:
        "`sentences` are the sentences of one paragraph, in order. Together they show the problem that `rule` defines, " +
        "across more than one sentence. `rule` also says which words to quote for that problem. Each option is one of " +
        "`sentences`. Which option holds the text that `rule` says to quote?",
    },
    criteria,
  };
}

/** Every span of one to `limit` words, plus every span that starts at the
 *  first word, as [first word, last word]. */
function spans(ws: Span[], limit: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ws.length; i++) for (let j = i; j < Math.min(ws.length, i + limit); j++) out.push([i, j]);
  for (let j = limit; j < ws.length; j++) out.push([0, j]);
  return out;
}

/** Method `sentence`, locate, one round: the question of run-rule-choice.ts. */
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

/** Method `across`, locate: the span in the chosen sentence. */
function pickAcross(rule: string, sentences: string[], sentence: string, options: Record<string, string>): ChoiceQuestion {
  return {
    type: "choice",
    instructions: {
      rule,
      sentences,
      sentence,
      question:
        "`sentences` are the sentences of one paragraph, in order. Together they show the problem that `rule` defines, " +
        "across more than one sentence. `sentence` is the one that holds the text `rule` says to quote for it. Each " +
        "option is a span of consecutive words from `sentence`. Which option is exactly the text `rule` says to " +
        "quote: all of it, and nothing more?",
    },
    criteria: options,
  };
}

/** The spans offered for one sentence, as option key -> exact text. */
function spanOptions(sentence: Span, ws: Span[], taken: [number, number][] = []): Record<string, string> {
  let limit = maxSpan;
  while (limit > 1 && spans(ws, limit).length > MAX_OPTIONS) limit--;
  let all = spans(ws, limit);
  if (all.length > MAX_OPTIONS) all = all.slice(0, MAX_OPTIONS);
  const options: Record<string, string> = {};
  for (const [a, b] of all) {
    if (taken.some(([c, d]) => a <= d && c <= b)) continue;
    options[`${a}-${b}`] = sentence.text.slice(ws[a]!.from, ws[b]!.to);
  }
  return options;
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

  /** Spans chosen so far in one paragraph, as paragraph offsets. */
  type Chosen = { from: number; to: number; finding: Finding; part: "sentence" | "across" };

  const sentencePart = async (slug: string, rule: string, chunk: number, para: string, sentence: Span, p: number, out: Chosen[]) => {
    const ws = wordsOf(sentence.text);
    if (!ws.length) return;
    const chosen: [number, number][] = [];
    const quotes: string[] = [];
    for (let round = 0; round < rounds; round++) {
      const options = spanOptions(sentence, ws, chosen);
      if (!Object.keys(options).length) break;
      const answers = await ask(slug, chunk, para, { quote: pick(rule, sentence.text, options, quotes) });
      const a = answers?.quote;
      if (!a || a.type !== "choice" || a.choice === "none" || !(a.choice in options)) break;
      const [from, to] = a.choice.split("-").map(Number) as [number, number];
      chosen.push([from, to]);
      const quote = options[a.choice]!;
      quotes.push(quote);
      out.push({
        from: sentence.from + ws[from]!.from,
        to: sentence.from + ws[to]!.to,
        part: "sentence",
        finding: {
          draft: name, pass: slug, quote, severity: severity(p),
          note: `Matches the pass rule "${slug}" (Jev across: sentence part, round ${round + 1}).`,
        },
      });
    }
  };

  const acrossPart = async (slug: string, rule: string, chunk: number, para: string, sentences: Span[], out: Chosen[]) => {
    const texts = sentences.map((s) => s.text);
    const d = await ask(slug, chunk, para, { across: detectAcross(rule, texts) });
    const a = d?.across;
    if (!a || a.type !== "noul" || a.noul < keepThreshold) return;
    const c = await ask(slug, chunk, para, { sentence: chooseSentence(rule, texts) });
    const cs = c?.sentence;
    if (!cs || cs.type !== "choice") return;
    const idx = Number(cs.choice.slice(1));
    const sentence = sentences[idx];
    if (!cs.choice.startsWith("s") || !sentence) return;
    const ws = wordsOf(sentence.text);
    if (!ws.length) return;
    const options = spanOptions(sentence, ws);
    const l = await ask(slug, chunk, para, { quote: pickAcross(rule, texts, sentence.text, options) });
    const q = l?.quote;
    if (!q || q.type !== "choice" || !(q.choice in options)) return;
    const [from, to] = q.choice.split("-").map(Number) as [number, number];
    out.push({
      from: sentence.from + ws[from]!.from,
      to: sentence.from + ws[to]!.to,
      part: "across",
      finding: {
        draft: name, pass: slug, quote: options[q.choice]!, severity: severity(a.noul),
        note: `Matches the pass rule "${slug}" (Jev across: paragraph part, sentence ${idx + 1}).`,
      },
    });
  };

  await Promise.all(
    paras.flatMap((para, chunk) =>
      passSlugs.map(async (slug) => {
        const rule = ruleText(slug, ruleSet);
        const sentences = sentencesOf(para);
        if (!sentences.length) return;
        candidates += sentences.length;
        const bySentence: Chosen[] = [];
        const byParagraph: Chosen[] = [];
        const sentenceWork = (async () => {
          const questions: Record<string, NoulQuestion> = {};
          sentences.forEach((s, i) => (questions[`q${i}`] = detect(rule, para, s.text)));
          const answers = await ask(slug, chunk, para, questions);
          if (!answers) return;
          await Promise.all(sentences.map((s, i) => {
            const a = answers[`q${i}`];
            if (a?.type !== "noul" || a.noul < keepThreshold) return;
            return sentencePart(slug, rule, chunk, para, s, a.noul, bySentence);
          }));
        })();
        const acrossWork = sentences.length >= 2 ? acrossPart(slug, rule, chunk, para, sentences, byParagraph) : null;
        await Promise.all([sentenceWork, acrossWork]);
        // Remove a span that overlaps one already chosen. The sentence part's
        // spans come first; an across span that overlaps one of them is dropped.
        const kept: Chosen[] = [];
        for (const c of [...bySentence, ...byParagraph]) {
          if (kept.some((k) => c.from < k.to && k.from < c.to)) continue;
          kept.push(c);
        }
        findings.push(...kept.map((k) => k.finding));
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
  source: "bench/scripts/jev-nolist/run-across.ts",
  config: {
    provider: "jev",
    orProvider: null,
    model: "jev-latest",
    thinking: "default" as const,
    thinkingPasses: {},
    pipeline: "plain" as const,
    rules: `${ruleSet} (verbatim, method across)`,
    scope: "native" as const,
    limit: 8,
    votes: null,
    need: null,
    ceilingSecs: ceiling,
    drafts,
    note:
      `Method across (SPEC §8.4): method sentence (one Noul per sentence, up to ${rounds} Choice rounds over spans of ` +
      `1-${maxSpan} words and every span from the first word), plus per paragraph of 2+ sentences one Noul, one Choice ` +
      `over sentences and one Choice over spans. Passes: ${passSlugs.join(", ")}. Keep >= ${keepThreshold}.`,
  },
  rules: "jev-nolist-across",
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
      `$${d.cost.toFixed(5)}  kept ${d.kept}  errors ${d.errors}`,
  );
}
for (const f of findings) console.log(`  ${f.draft}: "${f.quote}" (${f.severity}) — ${f.note}`);
if (result.scores) console.log(describe(label, result.scores, true));
console.log(`Jev spend this run: $${totalCost.toFixed(5)} over ${totalCalls} requests`);
console.log(`wrote ${outFile}`);
