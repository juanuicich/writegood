# Jev method `across`, filler words on the chapter, the reworded openings rule

23 September 2026. Three tests. Tests 1 and 3 score the sentence-openings
pass alone on the four scored drafts, which hold five reference items for it:
two late subjects in the essay, one run and one late subject in the memo, and
one late subject in the story. One item moves recall by 20 points.

Two rule sets appear below. `2026-09-23-rewrite` is the rule set the app
ships. `2026-09-23-jev-openings` changes only `03-sentence-openings.md`: it
says that sentences sharing only a first article or pronoun are not a run,
with the example "He opened the door. He sat down. He waited."

## 1. Sentence openings on Jev, method `across`

`scripts/jev-nolist/run-across.ts` builds method `across` as SPEC §8.4
describes it:

- Method `sentence` unchanged: one Noul per sentence with the rule text, then
  up to four Choice rounds over the sentence's spans.
- For each paragraph of two or more sentences: one Noul with the rule text and
  the sentences in order, which asks whether the problem lies across two or
  more sentences. Above the keep threshold, one Choice over the sentences
  picks the sentence that holds the quote, and one Choice over its spans picks
  the quote.
- Every Choice over spans lists the spans of one to eight words and every span
  that starts at the sentence's first word, at any length.
- An across span that overlaps a span from the sentence part is dropped.

The questions name the rule, not the problems that the rule describes. Code
only segments with `Intl.Segmenter`, lists sentences and spans, turns a chosen
option into a quote and removes overlaps. Keep threshold 0.45.

| Result | Rules | F1 | P | R | Exact quotes | Pronoun-only runs flagged | Requests per draft | Wall per draft | Cost per draft |
|---|---|---|---|---|---|---|---|---|---|
| jev-across-rw-1 | rewrite | 66.7% (50.0%, see below) | 57.1% | 80% | 3 of 3 real hits | 2 ("I…", "She…") | 20 | 6.1 s | $0.0017 |
| jev-across-rw-2 | rewrite | 61.5% | 50.0% | 80% | 3 of 4 hits, the 4th lacks a comma | 2 ("I left", "She") | 20.5 | 6.5 s | $0.0018 |
| jev-across-jo-1 | jev-openings | 72.7% | 66.7% | 80% | 3 of 4 hits, the 4th lacks a comma | 0 | 19.5 | 4.5 s | $0.0018 |
| jev-across-jo-2 | jev-openings | 72.7% | 66.7% | 80% | 3 of 4 hits, the 4th lacks a comma | 0 | 19.5 | 5.0 s | $0.0018 |
| ds-so-rw-1, -2 (test 3) | rewrite | 66.7%, 66.7% | 57%, 75% | 80%, 60% | 2 of 4, 2 of 3 | 2, 1 | 12 | 2.6 s, 3.0 s | $0.0024, $0.0029 |
| ds-so-jo-1, -2 (test 3) | jev-openings | 90.9%, 66.7% | 83%, 57% | 100%, 80% | 2 of 5, 2 of 4 | 0, 0 | 12 | 2.7 s, 2.2 s | $0.0028, $0.0026 |
| so-1, so-2 (not rule text only) | rewrite | 72.7%, 72.7% | 66.7% | 80% | - | 2 | - | - | - |
| jev-so-openings-1, -2 (not rule text only) | jev-openings | 100%, 88.9% | 100% | 100%, 80% | - | 0 | 40 | 10.8 s, 3.8 s | $0.0018 |

"Exact" compares a quote with the reference quote it overlaps, from
`scripts/jev-nolist/exactness.ts --passes sentence-openings`.

- The scored F1 of jev-across-rw-1 is 66.7%, but one of its four hits is an
  accident. Its finding "I" points at the run "I left… I reached… I arrived".
  The scorer places a quote at any of its occurrences, and one "I" falls
  inside the late subject "By the time I reached the top of the hill that
  February,". Without that hit the run scores 50.0%.
- Every real hit quotes the reference words. The one that `exactness.ts` calls
  partial is "After eleven years of sitting in morning traffic behind a school
  bus": the reference quote ends with a comma, and a word span cannot hold
  one. DeepSeek's "close" quotes differ the same way, by a trailing comma or
  space.
- The run "The board" was found by the across part in all four runs. The late
  subjects came from the sentence part, and their spans are 12 to 21 words
  long. The span list reaches them only because it offers every span from the
  first word.
- Jev never found the late subject "By the time I reached the top of the hill
  that February," (12 words). DeepSeek found it in two of four runs, both
  with the reworded rule.
- Two false positives stay with both rule sets: "It is" in two paragraphs of
  `on-writing.md`. Each holds only two sentences that open "It is a feeling",
  and the rule asks for three.
- With the rewrite rules, the across part flagged a pronoun-only run in both
  runs. With the reworded rule it flagged none, and the two runs gave the same
  findings.

Conclusion: method `across` with the rule text alone scores 72.7% with the
reworded rule. That is below the benchmark script's 89–100% and below
DeepSeek's 79% mean with the same rule, so sentence openings should stay on
DeepSeek.

## 2. Filler words on the chapter, Jev method `sentence`

`scripts/jev-nolist/run-rule-choice.ts --passes filler-words --keep 0.5
--drafts chapter.md`, rule set `2026-09-23-rewrite`, 8 requests in flight.

| Result | Words | Paragraphs | Sentences | Requests | Wall | p50 / p90 / max request | Cost | Errors | Largest request | Input tokens in all |
|---|---|---|---|---|---|---|---|---|---|---|
| jev-choice-fw-chapter | 5,038 | 113 | 353 | 115 | 7.4 s | 0.36 / 0.53 / 2.4 s | $0.0129 | 0 | 8,661 tokens | 307,192 |

- The largest request, one paragraph with one Noul per sentence, used 8,661
  input tokens. That is 14% of Jev's limit of 64,000 tokens.
- Jev kept one sentence of 353 and quoted "clearly". The chapter has no
  reference, so this measures nothing about quality. The chapter is `SPEC.md`,
  written to the rules the passes check.
- For comparison, the eight fast passes on DeepSeek took about 25 seconds and
  cost 10 to 17 cents on the chapter in the app (`app-runs.md`).

Conclusion: filler words on Jev handle a 5,000-word chapter in 7.4 seconds for
$0.013, with no error and no request near the token limit.

## 3. The reworded rule on DeepSeek

`run.ts --provider deepseek --model deepseek-flash --thinking off --pipeline
hybrid --passes sentence-openings`, the direct DeepSeek API, the settings of
R. Sentence openings sets no `thinking`, so it runs with the verifier: three
votes, two keeps.

| Result | Rules | F1 | P | R | TP | FP | FN | Pronoun-only runs flagged | Wall per draft | Cost per draft |
|---|---|---|---|---|---|---|---|---|---|---|
| ds-so-rw-1 | rewrite | 66.7% | 57.1% | 80% | 4 | 3 | 1 | 2 ("I left", "She rang") | 2.6 s | $0.0024 |
| ds-so-rw-2 | rewrite | 66.7% | 75.0% | 60% | 3 | 1 | 2 | 1 ("She rang her son Tom,") | 3.0 s | $0.0029 |
| ds-so-jo-1 | jev-openings | 90.9% | 83.3% | 100% | 5 | 1 | 0 | 0 | 2.7 s | $0.0028 |
| ds-so-jo-2 | jev-openings | 66.7% | 57.1% | 80% | 4 | 3 | 1 | 0 | 2.2 s | $0.0026 |

- The reworded rule removed every pronoun-only run: three with the rewrite
  rules, none with the reworded rule.
- The false positives left with the reworded rule are openings of ten words
  or fewer, which the rule excludes ("At a quarter past four on the ninth of
  March,", "In March and April,"), and one sentence of `on-writing.md` with no
  late subject.
- The earlier full runs, ds-direct-hybrid-1 and -2, scored 44% and 60% on this
  pass with the rewrite rules. These runs scored 66.7% twice. Two runs of
  five items cannot separate that from noise.

Conclusion: the reworded rule does not lower DeepSeek's score. The mean rises
from 66.7% to 78.8%, and pronoun-only runs disappear, so the wording can go
into the shared starter.

## Spend

| Account | Spent |
|---|---|
| Jev | $0.041: $0.028 for test 1, $0.013 for test 2 |
| DeepSeek direct | $0.043 (from the price table) |

No run was discarded.
