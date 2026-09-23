# Real-app runs, 23 September 2026

These numbers come from the debug build of the app, driven over WebDriver in a
throwaway home by `raw/scratch-scripts/app-run.ts`. The configuration is the
one the app ships: DeepSeek Flash with thinking off and the verifier for eight
passes, and paragraph order with thinking high (rule set `2026-09-23-rewrite`).

The script's output was not saved to a file. The numbers below were copied
from the session log. They are not scored against the reference.

"First note" is the time from ⌘R until the first finding reached the margin.
"8 passes" is the time until the eight passes with thinking off had stored
their findings. "Paragraph order" is the time until that pass finished. Cost
is the whole run, read from the app's database.

| Draft | Words | First note | 8 passes | Paragraph order | Cost |
|---|---|---|---|---|---|
| draft-memo.md | 541 | 2.2 s | 3–4 s | 74 s | $0.030 |
| draft-essay.md | 545 | 2.3 s | 2–4 s | 64 s | $0.028 |
| on-writing.md | 208 | 2.7 s | 3–4 s | 42 s | $0.024 |

## The chapter

`corpus/chapter.md`: 5,032 words as recorded (`wc -w` counts 5,038), in 112
paragraphs, about 790 calls. The draft is longer than one window (16,000
characters), so paragraph calls send windows of the draft.

| Run | Fast passes | Paragraph order | Cost |
|---|---|---|---|
| First run | about 25 s | 110–145 s | $0.10–0.17 |
| After editing one paragraph | about 3 s | about 2 min | — |
| No edit | 1.5 s, no calls | no call | $0 |

With thinking off, 11 of about 790 replies had no readable findings: prose or
a refusal. Each failed only its own call.
