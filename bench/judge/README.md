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
