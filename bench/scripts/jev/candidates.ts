/** Finds candidate spans in one paragraph for the passes this benchmark
 *  tests without a generative model: nominalization, passive-actor and
 *  filler-words feed a Jev question per candidate; sentence-openings and the
 *  code-only filler-words variant decide with no model at all.
 *
 *  Candidate generation is deliberately broad. A wrong candidate costs a
 *  cheap Jev call or a discarded code finding; a missed candidate is a
 *  finding the benchmark can never produce. Precision is Jev's job, or the
 *  deterministic rule's job for the code-only passes. */

export interface Sentence {
  text: string;
  from: number;
  to: number;
}

/** A trimmed slice, with its bounds moved in to match — so a position found
 *  inside `.text` (by regex, relative to `.text`) lands on the right
 *  character when added to `.from`. Trimming without this shift was a real
 *  bug here: every match after a sentence's leading space landed one
 *  character early. */
function trimmedSlice(paragraph: string, rawFrom: number, rawTo: number): Sentence | null {
  const raw = paragraph.slice(rawFrom, rawTo);
  const from = rawFrom + (raw.length - raw.trimStart().length);
  const to = rawTo - (raw.length - raw.trimEnd().length);
  if (from >= to) return null;
  return { text: paragraph.slice(from, to), from, to };
}

/** Naive sentence split on one of . ! ? followed by space or end. Good
 *  enough for the benchmark's plain prose; it does not handle abbreviations. */
export function sentencesOf(paragraph: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  const re = /[.!?]+(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph))) {
    const end = m.index + m[0].length;
    const s = trimmedSlice(paragraph, start, end);
    if (s) sentences.push(s);
    start = end;
  }
  const rest = trimmedSlice(paragraph, start, paragraph.length);
  if (rest) sentences.push(rest);
  return sentences;
}

export interface Candidate {
  quote: string;
  from: number;
  to: number;
  sentence: string;
  /** Extra fields a rule's own logic needs, e.g. filler-words' category. */
  meta: Record<string, string>;
}

function matches(re: RegExp, text: string): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ text: m[0], from: m.index, to: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

// ---------------------------------------------------------------- nominalization

const WEAK_VERB =
  /\b(?:made|make|makes|making|given|give|gives|giving|took|take|takes|taking|taken|had|have|has|having|did|do|does|doing|done|conducted|conduct|conducts|conducting|carried\s+out|carries\s+out|carry\s+out|carrying\s+out|performed|perform|performs|performing|provided|provide|provides|providing|occurred|occur|occurs|occurring|come\s+to|comes\s+to|came\s+to|coming\s+to|took\s+place|takes\s+place|taking\s+place|there\s+(?:is|was|are|were)|is|are|was|were|be|been|being)\b/gi;

const NOMINAL_SUFFIX = /\b[A-Za-z]{4,}(?:tions?|sions?|ments?|ances?|ences?|encies|ancies|ency|ancy|ures?|ysis|yses)\b/g;

const EXTRA_NOMINAL_NOUNS = new Set([
  "review", "reviews", "undertaking", "undertakings", "attempt", "attempts", "effort", "efforts",
  "look", "guess", "estimate", "estimates", "request", "requests", "offer", "offers", "promise",
  "promises", "claim", "claims", "study", "studies", "survey", "surveys", "search", "searches",
  "visit", "visits", "report", "reports", "change", "changes", "increase", "increases", "decrease",
  "decreases", "answer", "answers", "response", "responses",
]);

const MAX_GAP_WORDS = 8;

/** Word count between two spans in the same sentence, roughly. */
function wordGap(a: { from: number; to: number }, b: { from: number; to: number }, sentence: string): number {
  const from = Math.min(a.to, b.to);
  const to = Math.max(a.from, b.from);
  if (to <= from) return 0;
  return sentence.slice(from, to).trim().split(/\s+/).filter(Boolean).length;
}

export function findNominalizationCandidates(paragraph: string): Candidate[] {
  const out: Candidate[] = [];
  for (const s of sentencesOf(paragraph)) {
    const verbs = matches(WEAK_VERB, s.text);
    const suffixNouns = matches(NOMINAL_SUFFIX, s.text);
    const extraNouns = matches(/\b[A-Za-z]+\b/g, s.text).filter((w) => EXTRA_NOMINAL_NOUNS.has(w.text.toLowerCase()));
    const nouns = [...suffixNouns, ...extraNouns].sort((a, b) => a.from - b.from);
    const seen = new Set<string>();
    for (const noun of nouns) {
      let best: { text: string; from: number; to: number } | null = null;
      let bestGap = Infinity;
      for (const v of verbs) {
        const gap = wordGap(v, noun, s.text);
        if (gap <= MAX_GAP_WORDS && gap < bestGap) { best = v; bestGap = gap; }
      }
      if (!best) continue;
      const from = Math.min(best.from, noun.from);
      const to = Math.max(best.to, noun.to);
      const key = `${from}-${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        quote: paragraph.slice(s.from + from, s.from + to),
        from: s.from + from,
        to: s.from + to,
        sentence: s.text,
        meta: { verb: best.text.trim(), noun: noun.text },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- passive-actor

const PARTICIPLE =
  /\b(?:not\s+|never\s+|also\s+|then\s+|already\s+|still\s+|just\s+|only\s+|widely\s+|often\s+|later\s+|recently\s+)?(?:[a-z]+ed|[a-z]+en|known|shown|given|taken|written|done|made|seen|found|left|held|told|sold|sent|built|brought|thought|bought|caught|taught|kept|sought|understood|felt|said|paid|put|set|read|met|lost|won|chosen|broken|spoken|driven|risen|fallen|grown|drawn|worn|torn|sworn|born|hidden|forbidden|beaten|eaten|frozen|stolen|woken|arisen|forgotten|gotten|begun|sung|drunk|sunk|shrunk|swum|rung|sprung|stung|flown|blown|thrown|sewn|mown|hewn|laid|spent|bent|lent|dealt|meant|slept|swept|wept|crept|knelt|lit|spelt|burnt|smelt|leapt)\b/i;

const PASSIVE = new RegExp(`\\b(?:is|are|was|were|be|been|being)\\s+${PARTICIPLE.source}`, "gi");
const IMPERSONAL =
  /\bit\s+(?:is|was|has\s+been|had\s+been)\s+(?:decided|recommended|believed|thought|felt|noted|agreed|understood|concluded|reported|argued|suggested|proposed|assumed|expected|hoped|found|said|claimed|determined)\s+that\b/gi;

/** Adjectival participles that read as descriptions, not hidden actions. */
const ADJECTIVAL = new Set([
  "closed", "located", "based", "situated", "interested", "involved", "concerned", "married",
  "committed", "dedicated", "devoted", "associated", "aware", "satisfied", "pleased", "tired",
  "excited", "worried", "surprised", "shocked", "scared", "confused", "bored", "related",
]);

export function findPassiveActorCandidates(paragraph: string): Candidate[] {
  const out: Candidate[] = [];
  for (const s of sentencesOf(paragraph)) {
    const seen = new Set<string>();
    for (const m of [...matches(PASSIVE, s.text), ...matches(IMPERSONAL, s.text)]) {
      const key = `${m.from}-${m.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lastWord = m.text.trim().split(/\s+/).pop()!.toLowerCase();
      if (ADJECTIVAL.has(lastWord)) continue;
      // A stated actor: "by" within the next few words.
      const after = s.text.slice(m.to, m.to + 30);
      if (/^\s*(?:by\b)/i.test(after)) continue;
      out.push({
        quote: paragraph.slice(s.from + m.from, s.from + m.to),
        from: s.from + m.from,
        to: s.from + m.to,
        sentence: s.text,
        meta: {},
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- filler-words

type FillerKind = "intensifier" | "hedge" | "stock";

const FILLER_WORDS: { re: RegExp; kind: FillerKind }[] = [
  { re: /\b(?:very|really|quite|truly|extremely|incredibly|totally)\b/gi, kind: "intensifier" },
  { re: /\b(?:clearly|obviously|of course|unfortunately|interestingly|importantly|basically|actually|essentially|sort of|kind of)\b/gi, kind: "hedge" },
  {
    re: /\b(?:it should be noted that|it is important to remember that|it is worth mentioning that|needless to say|the fact that)\b/gi,
    kind: "stock",
  },
];

export function findFillerCandidates(paragraph: string): Candidate[] {
  const out: Candidate[] = [];
  for (const { re, kind } of FILLER_WORDS) {
    for (const m of matches(re, paragraph)) {
      // Sentence context for the Jev question; falls back to a local window.
      const sentence = sentencesOf(paragraph).find((s) => m.from >= s.from && m.from < s.to);
      out.push({
        quote: paragraph.slice(m.from, m.to),
        from: m.from,
        to: m.to,
        sentence: sentence?.text ?? paragraph.slice(Math.max(0, m.from - 80), Math.min(paragraph.length, m.to + 80)),
        meta: { kind },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sentence-openings (plain code)

const INTRO_MARKERS = new Set([
  "by", "after", "when", "while", "since", "although", "because", "given", "with", "before",
  "once", "if", "as", "despite", "during", "following", "having", "upon", "though", "unless",
  "until", "whereas", "whenever", "wherever",
]);

export interface CodeFinding {
  quote: string;
  from: number;
  to: number;
  severity: "low" | "medium" | "high";
  note: string;
}

/** Runs of repeated openings and late subjects, entirely in code — no model
 *  involved, matching the plain-code variant asked for in the task. */
export function findSentenceOpenings(paragraph: string): CodeFinding[] {
  const out: CodeFinding[] = [];
  const sentences = sentencesOf(paragraph);

  // Runs: 3+ consecutive sentences sharing the same first two words.
  const key = (t: string) => t.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase().replace(/[.,;:!?"'"]/g, "");
  let i = 0;
  while (i < sentences.length) {
    const k = key(sentences[i]!.text);
    if (!k || k.split(" ").length < 2) { i++; continue; }
    let j = i + 1;
    while (j < sentences.length && key(sentences[j]!.text) === k) j++;
    const runLen = j - i;
    if (runLen >= 3) {
      const first = sentences[i]!;
      const words = first.text.trim().split(/\s+/);
      const openLen = words.slice(0, 2).join(" ").length;
      const quote = first.text.slice(0, openLen);
      out.push({
        quote,
        from: first.from,
        to: first.from + openLen,
        severity: runLen >= 4 ? "high" : "medium",
        note: `Repeated opening words across ${runLen} consecutive sentences.`,
      });
    }
    i = j;
  }

  // Late subject: sentence opens on an intro marker, with 10+ words before
  // the first comma.
  for (const s of sentences) {
    const commaIdx = s.text.indexOf(",");
    if (commaIdx < 0) continue;
    const lead = s.text.slice(0, commaIdx);
    const words = lead.trim().split(/\s+/).filter(Boolean);
    const firstWord = words[0]?.toLowerCase().replace(/[^a-z]/g, "");
    if (!firstWord || !INTRO_MARKERS.has(firstWord)) continue;
    const n = words.length;
    if (n <= 10) continue;
    const severity = n > 25 ? "high" : n >= 16 ? "medium" : "low";
    out.push({
      quote: s.text.slice(0, commaIdx),
      from: s.from,
      to: s.from + commaIdx,
      severity,
      note: `${n} words come before the sentence's subject.`,
    });
  }

  return out;
}

// ---------------------------------------------------------------- filler-words (plain code)

const FILLER_SEVERITY: Record<FillerKind, "low" | "medium" | "high"> = {
  intensifier: "low",
  hedge: "medium",
  stock: "high",
};

const FILLER_NOTE: Record<FillerKind, string> = {
  intensifier: "Intensifier that adds emphasis only.",
  hedge: "Empty hedge or claim of obviousness that adds no fact.",
  stock: "Stock phrase that delays the content and adds nothing.",
};

export function findFillerWordsCode(paragraph: string): CodeFinding[] {
  return findFillerCandidates(paragraph).map((c) => {
    const kind = c.meta.kind as FillerKind;
    return { quote: c.quote, from: c.from, to: c.to, severity: FILLER_SEVERITY[kind], note: FILLER_NOTE[kind] };
  });
}
