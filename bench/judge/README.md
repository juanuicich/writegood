# The judge step

The reference findings miss real problems. A finding that matches no
reference item counts as a false positive, even when it is right. The judge
step measures how often that happens.

## What was judged

The unmatched findings of two runs, on 23 September 2026:

- `fp-B.json`: 51 unmatched findings of `B-flash-high` (Flash, thinking on for
  every pass: the app's setting before the fast passes).
- `fp-P.json`: 27 unmatched findings of `P-fast-1` (Flash, thinking off,
  filters and verifier).

`fp-items.json` merges the two into 62 items; a finding that both runs made
is one item. `fp-sources.json` maps each item id to the runs that made it.
The unanchored finding of `B-flash-high` (a quote not in the draft) was not
judged, so `score.ts --dump` lists 52 findings for that run, not 51.

An Opus judge saw each item with its draft and the rule of its pass. It
answered `valid`, `invalid` or `duplicate` (the same problem as another
finding), and whether the note leaks replacement wording. The verdicts are in
`fp-verdicts.json`.

## Result

22 of the 62 items are valid problems that the reference missed. No note
leaked replacement wording.

| Run | tp | fp | Precision | Valid among fp | Precision after judging |
|---|---|---|---|---|---|
| B-flash-high | 71 | 52 | 58% | 21 | 75% |
| P-fast-1 | 52 | 27 | 66% | 6 | 73% |

Precision after judging is (tp + valid) / (tp + fp). The reference was not
changed, so every score in `RESULTS.md` is against the reference alone.

Judging raises the precision of B-flash-high by 17 points and of P-fast-1 by
7 points. After judging, the two differ by 2 points.

## The OpenRouter hybrids

On 23 September 2026, the unmatched findings of ten composed results were
judged: two runs each of DeepSeek direct + Gemini low, DeepSeek through
OpenRouter + Gemini low, Luna + Gemini low, Qwen3.8 + Gemini low, and R.
`results/2026-09-23-openrouter.md` describes the runs.

- `or-items.json`: 119 items. A finding that several runs made is one item.
- `or-sources.json`: the runs that made each item.
- `or-verdicts.json`: the verdicts. A valid item names its `problem`, so two
  findings of one run on the same problem count once.

The judge was the Opus agent that ran the benchmark, with each draft and the
rule of each pass. It used the same three verdicts as above. 34 items are
valid, 76 invalid and 9 duplicates. No note leaked replacement wording.

| Run | tp | fp | Precision | Valid among fp | Precision after judging |
|---|---|---|---|---|---|
| R-1 | 58 | 23 | 71.6% | 8 | 81.5% |
| R-2 | 61 | 27 | 69.3% | 11 | 81.8% |
| H-dsdirect-gemlow-1 | 59 | 25 | 70.2% | 8 | 79.8% |
| H-dsdirect-gemlow-2 | 61 | 28 | 68.5% | 11 | 80.9% |
| H-dsflash-gemlow-1 | 56 | 31 | 64.4% | 7 | 72.4% |
| H-dsflash-gemlow-2 | 59 | 38 | 60.8% | 9 | 70.1% |
| H-luna-gemlow-1 | 43 | 8 | 84.3% | 5 | 94.1% |
| H-luna-gemlow-2 | 43 | 5 | 89.6% | 2 | 93.8% |
| H-qwen38-gemlow-1 | 53 | 28 | 65.4% | 9 | 76.5% |
| H-qwen38-gemlow-2 | 52 | 26 | 66.7% | 6 | 74.4% |

Most invalid items fall into four groups: sentences that share only the
pronoun "I" or "She", narrative sequences read as repeated templates, topic
flow on an element any reader can place, and a problem reported under the
wrong pass. Of the 30 items that the first judge had also seen, this judge
agreed on 27.
