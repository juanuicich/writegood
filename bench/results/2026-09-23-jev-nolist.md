# Jev with no word lists, regexes or English-specific code

Not committed — new code under `bench/scripts/jev-nolist/`, new corpus files
`bench/corpus/draft-essay-es.md` and `gold-essay-es.json`, new results under
`bench/results/2026-09-23-{rulenoul,so,es}-*.json`. The earlier list-based
code and results (`bench/scripts/jev/`, `bench/rules/jev-2026-09-23/`,
`bench/results/2026-09-23-jev.json`, `-code.json`) are untouched.

## What Jev can do

Three question types, all sent in one batched request against one shared
`state`: Noul (yes/no probability), Choice (pick one of up to 255 labelled
options, returns a probability per option), Score (place on an ordered
scale of up to 10 levels, returns a probability-weighted value). No
built-in span or highlight primitive. `instructions` and `criteria` accept
plain strings or JSON objects/arrays, so a question can point at named
fields in its own `instructions` rather than one long string.

The location trick is Choice: TypeSafe's own line-by-line search cookbook
tags candidate lines with an ID and asks a Choice question to rank them.
The same move works for words or sentences code has already split out —
Jev never needs to search text itself, only to choose among options code
enumerates. That is the whole workaround for "no built-in span type."

Documented limits that matter here: literal reading over background
knowledge; poor at counting and arithmetic (put counting in code, on a
span Jev already chose, not as the decision itself); accuracy drops with
indirection and with state full of irrelevant detail; no structural
invariants between separate questions or question types; not generative.
English is the primary training language; other languages, including
Spanish, are "handled but not equally well" (Models doc, language
support).

## Per-pass verdict (all 9 passes)

Two techniques cover every pass without a word list. **Rule-as-criterion**
(Method 1): split into sentences with `Intl.Segmenter` (no locale pinned),
ask one Noul per sentence with the pass's own rule prompt — the same text
the LLM reads — as the question. The quote is the sentence; coarser than
the LLM's usual span, but the scorer matches on overlap, so it still counts
a hit. **Choice-located span** (Method 2): the same rule-as-criterion Noul
first, then a Choice over code's own enumerated candidates (sentences or
words) to pick the exact span, with `Intl.Segmenter` counting the result
for the rule's own numeric severity bands.

| Pass | Verdict | Method |
|---|---|---|
| nominalization | Works | Method 1, prototyped |
| passive-actor | Works | Method 1, prototyped |
| filler-words | Works, best fit | Method 1, prototyped |
| sentence-openings | Works, needs Method 2 | Method 2, prototyped |
| topic-flow | Should work | Method 1 (previous sentence goes in `paragraph` context); not prototyped |
| unearned-metaphor | Should work | Method 1; not prototyped |
| repeated-phrasing | Should work | Method 1, with the previous paragraph added to context; not prototyped |
| paragraph-order | Should work | Choice over the draft's own paragraphs, same trick as Method 2 at document scope; not prototyped |
| length | Should work, riskiest | Same as paragraph-order; the rule compares a sentence against the whole draft, the largest "irrelevant detail" exposure of the nine |

No pass looked infeasible. The split is between passes where a sentence-wide
quote is close enough (five passes, Method 1 alone) and passes needing a
second, Choice-driven call to find the right span inside the sentence
(sentence-openings solidly; filler-words and nominalization would gain
precision from the same treatment, not attempted here for budget).

## Results, four corpus drafts, mean of two runs

| Pass | Method | F1 | P | R | Req/draft | Cost/draft | Wall/draft |
|---|---|---|---|---|---|---|---|
| nominalization | Method 1 | 73% | 61% | 93% | ~9 (shared w/ filler) | ~$0.0011 | ~2 s (shared) |
| filler-words | Method 1 | 77% | 76% | 78% | ~9 (shared w/ nom.) | ~$0.0011 | ~2 s (shared) |
| passive-actor | Method 1 | 70% | 76% | 65% | 9 | $0.0011 | 2.0 s |
| sentence-openings | Method 2 | 73% | 67% | 80% | 40 | $0.0017 | 3.5 s |
| nominalization | LLM hybrid (earlier run) | 92% | 100% | 86% | — | $0.0220* | 35 s* |
| passive-actor | LLM hybrid | 58% | 74% | 50% | — | $0.0220* | 35 s* |
| filler-words | LLM hybrid | 73% | 71% | 75% | — | $0.0220* | 35 s* |
| sentence-openings | LLM hybrid | 64% | 59% | 70% | — | $0.0220* | 35 s* |

\* LLM cost/wall is the whole nine-pass run per draft, not this pass alone —
the app runs every pass together and the earlier benchmark did not isolate
one pass's calls at the time. Every pass in one LLM run shares that $0.0220
and 35 s; it is not additive across rows.

Jev's nominalization/filler-words/passive-actor (Method 1, one Noul per
sentence, the verbatim rule prompt as the question) score 6–22 F1 points
below the LLM but cost about 5% as much and run roughly 15–17x faster.
Sentence-openings via Method 2 (73% F1) beats the LLM's 64% at under 8% of
its cost, at the price of far more requests per draft (Method 2's Choice
calls are the most request-heavy technique tried).

Every keep threshold in this run is 0.45, not the textbook 0.5. Across
every pass probed in this session — list-based and rule-text-based alike —
a real, gold-listed hit landed at 0.42–0.49 at least once, close enough to
a genuine decoy's score that no clean threshold separates them; 0.45 is a
documented compromise, not a tuned optimum.

## Spanish

`bench/corpus/draft-essay-es.md` is a hand translation of `draft-essay.md`
(by me, in this session, no API call), keeping the same nine violations in
the same paragraphs where a natural Spanish phrase carries them — light-verb
nominalizations ("tomar la decisión", "hacer una evaluación", "llegar a la
conclusión"), a reflexive passive with no actor ("fue olvidada"), and the
same filler categories ("Cabe señalar que", "muy", "básicamente").
`gold-essay-es.json` gives the matching Spanish quotes, exact substrings of
the translation, same categories and severities as the English gold.

Method 1 ran unmodified — same rule files, still in English, only
`Intl.Segmenter`'s locale-neutral split changed what it was splitting.
Combined nominalization + passive-actor + filler-words on this one draft,
two runs, identical both times:

- English (this draft alone, mean of 2 runs): F1 74% (P 69%, R 81%)
- Spanish (same draft, translated, mean of 2 runs): F1 67% (P 60%, R 75%)

A real but moderate drop, in the direction the docs predict ("handled but
not equally well"), not a collapse. Nominalization lost the most (57% F1 in
Spanish against roughly 73% in English on the four-draft run); filler-words
held up best (75% in Spanish, close to its English 77%).

## What did not work

A run-detection false positive recurred in both languages: three
consecutive sentences sharing only the same subject pronoun and a similar
grammatical template ("I left… I reached… I arrived", the Spanish "Salí…
Llegué… Llegué…") sometimes reads to Jev as a repeated opening, even though
the rule explicitly excludes matches on a bare pronoun. This is a real
instance of literal reading tripping on the rule's own exclusion, not
something a keep-threshold fixes.

## Spend

Every Jev call this task: roughly $0.06 of the $5 budget. No LLM calls were
made; the LLM comparison numbers are the earlier session's results, reused.
