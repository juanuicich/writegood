# OpenRouter models for the passes

23 September 2026. Rule set `2026-09-23-rewrite`. Every call went through
OpenRouter to the model's own vendor, with fallbacks off. Each configuration
ran twice on the four scored drafts. The two numbers in a cell are run 1 and
run 2.

## Recommendation

Keep DeepSeek Flash on the direct DeepSeek API for the eight fast passes. Move
paragraph order to Gemini 3.8 Flash at `low` effort, through OpenRouter.

| Configuration | F1 | Precision after judging | First findings | Wall per draft | Cost per draft |
|---|---|---|---|---|---|
| R: DeepSeek Flash, paragraph order at high | 71.2%, 71.8% | 81.5%, 81.8% | 5.9 s, 6.1 s | 29.9 s, 39.7 s | $0.0215, $0.0225 |
| DeepSeek Flash, paragraph order on Gemini low | 71.1%, 71.3% | 79.8%, 80.9% | 5.9 s, 6.1 s | 6.2 s, 6.1 s | $0.0195, $0.0188 |

The recommended configuration scores the same F1 as R. Paragraph order
arrives about 30 seconds sooner, so a draft is complete in about 6 seconds.
It costs about 10% less. On `chapter.md`, Gemini low answered paragraph order
in 2.7 seconds for $0.007. The app took 110 to 145 seconds for that pass.

Its paragraph-order score is lower: 80% in both runs, against 83% and 86% for
DeepSeek Flash at high. The pass has six reference items, so the gap is one
finding. At `low`, Gemini reported no reasoning tokens on three of the four
drafts, so it mostly answers without thinking.

The app would need a second provider for this one pass. No app code was
changed.

## Fast passes

Eight passes, pipeline `fast`, 76 reference items. For comparison, the
direct-DeepSeek runs X3-tf-para-1 and -2 score 70% and 71% on the same eight
passes.

| Model | Provider | Reasoning | F1 | P | R | First findings | p50 / p90 call | Cost per draft | Failed calls |
|---|---|---|---|---|---|---|---|---|---|
| deepseek/deepseek-v4.1-flash | DeepSeek | off | 64.9%, 64.6% | 64%, 60% | 66%, 70% | 5.1 s, 5.7 s | 1.4 / 2.1 s | $0.0168, $0.0160 | 0, 0 |
| openai/gpt-6-luna | OpenAI | effort none | 62.7%, 64.3% | 88%, 95% | 49%, 49% | 9.6 s, 10.8 s | 2.0 / 2.9 s | $0.0136, $0.0137 | 0, 0 |
| qwen/qwen3.8-flash | Alibaba | off | 63.5%, 63.4% | 65%, 67% | 62%, 61% | 17.5 s, 19.2 s | 2.1 / 4.7 s | $0.0084, $0.0079 | 0, 20 |
| inception/mercury-2.5 | Inception | effort none | 56.0%, 48.3% | 71%, 66% | 46%, 38% | 5.3 s, 5.0 s | 1.3 / 2.4 s | $0.0054, $0.0051 | 5, 18 |
| qwen/qwen3.7-flash | Alibaba | off, cache_control on | 32.6%, 44.3% | 37%, 53% | 29%, 38% | 65.8 s, 28.9 s | 1.8 / 4.3 s | $0.0057, $0.0064 | 89, 17 |
| xiaomi/mimo-v2.6-flash | Xiaomi | off | 28.6%, 32.7% | 64%, 73% | 18%, 21% | 21.0 s, 47.4 s | 3.6 / 6.4 s | $0.0152, $0.0156 | 131, 113 |

- DeepSeek v4.1 Flash through OpenRouter scores 5 to 6 points below the
  direct-DeepSeek runs, in both runs. This test cannot separate two causes.
  The model may differ from the one behind the direct API's `deepseek-flash`.
  Also, X3 ran in the scratch harness, not in `run.ts`. A direct-DeepSeek run
  through `run.ts` would separate them.
- GPT-6 Luna makes few findings, and almost all are right. Its judged
  precision is 94%. Its recall is 49%. Topic flow found 0 and 2 of the 5
  reference items. Its first findings take 10 seconds.
- Qwen3.8 Flash is the cheapest model with a usable score. Alibaba returned
  429 (rate-limited upstream) for 20 calls in run 2 at the app's limit of 32
  calls per draft. Its first findings take 17 to 19 seconds.
- Mercury 2.5 is as fast as DeepSeek and costs a third. It loses 10 to 17
  points of F1. Its verifier replies often hold no verdicts.
- Qwen3.7 Flash ran with `cache_control` breakpoints on the system prompt and
  on the draft and task. Cache reads were 5% of input. The calls of a draft
  start together, so most start before a cache entry exists. Alibaba returned
  429 for many calls, even with no other Alibaba run at the same time.
  Qwen3.8, without breakpoints, read 81% of its input from cache.
- MiMo V2.6 Flash with reasoning off often returns a bare JSON object or
  `{"findings": []}`, not an array. The app's parser rejects those replies:
  131 and 112 of 256 pass calls.

## Paragraph order

One pass, pipeline `plain`, 6 reference items. DeepSeek Flash at high, from
R-1 and R-2, scores 83% and 86%, takes 30 to 40 seconds and costs $0.005 per
draft.

| Model | Provider | Reasoning | F1 | P | R | Wall per draft | Cost per draft |
|---|---|---|---|---|---|---|---|
| google/gemini-3.8-flash | Google AI Studio | effort low | 80.0%, 80.0% | 67%, 67% | 100%, 100% | 3.4 s, 3.2 s | $0.0025, $0.0023 |
| google/gemini-3.8-flash | Google AI Studio | effort medium | 85.7%, 83.3% | 75%, 83% | 100%, 83% | 52.1 s, 51.2 s | $0.0528, $0.0565 |
| xiaomi/mimo-v2.6-pro | Xiaomi | enabled | 71.4%, 83.3% | 63%, 83% | 83%, 83% | 184.8 s, 88.4 s | $0.0088, $0.0046 |
| xiaomi/mimo-v2.6-flash | Xiaomi | enabled | 76.9%, 71.4% | 71%, 63% | 83%, 83% | 189.7 s, 142.7 s | $0.0020, $0.0023 |
| z-ai/glm-5.3-flash | Z.AI | effort high | 58.8%, 66.7% | 45%, 56% | 83%, 83% | 125.6 s, 81.6 s | $0.0021, $0.0014 |
| openai/gpt-6-luna | OpenAI | effort medium | 61.5%, 46.2% | 57%, 43% | 67%, 50% | 35.9 s, 33.1 s | $0.0018, $0.0017 |
| openai/gpt-6-luna | OpenAI | effort high | 46.2%, 66.7% | 43%, 67% | 50%, 67% | 42.8 s, 37.0 s | $0.0022, $0.0022 |

- Gemini at medium scores 3 to 6 points above low. It takes 50 seconds and
  costs 20 times as much.
- Google AI Studio returned 429 when two Gemini configurations ran at the same
  time (eight calls). Those two runs were discarded and run again one at a
  time. The app sends one paragraph-order call per draft.
- The MiMo models and GLM take 1.5 to 4 minutes per call. One MiMo Flash call
  failed when the connection closed after 270 seconds.
- Luna was weak at medium, so it also ran at high. High was no better.

## Hybrids

`scripts/merge.ts` composes a hybrid from a fast-pass run and a
paragraph-order run. Run 1 pairs with run 1, and run 2 with run 2.

| Hybrid | F1 | Precision after judging | First findings | Wall per draft | Cost per draft |
|---|---|---|---|---|---|
| DeepSeek direct + Gemini low | 71.1%, 71.3% | 79.8%, 80.9% | 5.9 s, 6.1 s | 6.2 s, 6.1 s | $0.0195, $0.0188 |
| DeepSeek (OpenRouter) + Gemini low | 66.3%, 65.9% | 72.4%, 70.1% | 5.1 s, 5.7 s | 5.6 s, 5.7 s | $0.0193, $0.0183 |
| DeepSeek (OpenRouter) + Gemini medium | 66.7%, 65.9% | - | 5.1 s, 5.7 s | 52.1 s, 51.2 s | $0.0696, $0.0726 |
| Luna none + Gemini low | 64.7%, 66.2% | 94.1%, 93.8% | 9.6 s, 10.8 s | 9.6 s, 10.8 s | $0.0161, $0.0159 |
| Luna none + Gemini medium | 65.2%, 66.1% | - | 9.6 s, 10.8 s | 52.1 s, 51.2 s | $0.0664, $0.0702 |
| Qwen3.8 + Gemini low | 65.0%, 65.0% | 76.5%, 74.4% | 17.5 s, 19.2 s | 17.5 s, 19.2 s | $0.0109, $0.0102 |
| Qwen3.8 + Gemini medium | 65.4%, 65.0% | - | 17.5 s, 19.2 s | 52.1 s, 51.2 s | $0.0612, $0.0645 |

The direct-DeepSeek hybrid takes its eight passes from X3-tf-para-1 and -2.
Those are converted results. Their verifier cost is recorded per draft, so it
includes the verifier calls of paragraph order at thinking off, a few tenths
of a cent.

## The chapter

One run on `chapter.md` (5,032 words, 112 paragraphs, in windows), for
latency and cost. Paragraph order ran on Gemini low.

| Configuration | Calls | Wall | Cost |
|---|---|---|---|
| DeepSeek (OpenRouter) + Gemini low | 937 | 35.4 s | $0.169 |
| Luna none + Gemini low | 820 | 52.9 s | $0.218 |

- The chapter is the app's own specification. 22 DeepSeek replies had no
  readable findings. 20 of them were refusals that said the task conflicts
  with its role, because the draft describes the passes themselves.
- Luna returned `[]` for 781 of 792 pass calls and kept no finding.
- Luna read nothing from cache. OpenAI charges cache writes at 1.25 times the
  input price, so Luna costs more than DeepSeek on a long draft. DeepSeek
  read 64% of its input from cache.
- `results/app-runs.md` has the direct-DeepSeek timings for the chapter: about
  25 seconds for the fast passes, $0.10 to $0.17.

## Providers and reasoning settings

Every model had a first-party endpoint on OpenRouter. No model was skipped.

| Model | Pinned provider | Setting sent |
|---|---|---|
| deepseek/deepseek-v4.1-flash | `deepseek` | `reasoning: {enabled: false}` |
| openai/gpt-6-luna | `openai` | `reasoning: {effort: "none" / "medium" / "high"}` |
| inception/mercury-2.5 | `inception` | `reasoning: {effort: "none"}` |
| qwen/qwen3.8-flash | `alibaba` | `reasoning: {enabled: false}` |
| qwen/qwen3.7-flash | `alibaba` | `reasoning: {enabled: false}`, `cache_control` on |
| xiaomi/mimo-v2.6-flash | `xiaomi` | `reasoning: {enabled: false}` or `{enabled: true}` |
| xiaomi/mimo-v2.6-pro | `xiaomi` | `reasoning: {enabled: true}` |
| google/gemini-3.8-flash | `google-ai-studio` | `reasoning: {effort: "low" / "medium"}` |
| z-ai/glm-5.3-flash | `z-ai` | `reasoning: {effort: "high"}` |

- The MiMo models list no effort levels, so they were switched on or off.
- Gemini 3.8 Flash and GLM 5.3 Flash make reasoning mandatory. GLM accepts
  `max`, `high` and `low`; `high` matches DeepSeek's setting.
- The `openai` pin reached OpenAI's standard tier. The reported cost matches
  $0.10 and $0.50 per million tokens, not the flex or fast rates.
- No model rejected a setting.

## Spend

OpenRouter reported $1.73 for this work, against a budget of $15. That
includes $0.26 for six runs that were discarded, and for the probes. The key
has a limit of $2, so $0.27 was left.

Discarded runs: three fast runs that ran with the wrong pipeline because of a
shell quoting mistake, one Qwen3.7 run that shared Alibaba with Qwen3.8, and
the two Gemini runs above.
