# The pass benchmark

This folder measures the editing passes on three things: quality, latency and
cost. A run sends the passes of one rule set to one model, scores the findings
against a reference, and writes one result file. `RESULTS.md` compares every
result so far.

The benchmark uses the app's own code for the preamble, the prompt builder, the
parser, the code filters, the verifier, the call limiter and the windows
(`src/lib/passes/`). For agy it also uses the app's runner. Only the network
call to DeepSeek and OpenRouter is the benchmark's own, so it can reach
providers the app does not have yet.

## Layout

| Path | What it holds |
|---|---|
| `corpus/` | The drafts, the answer keys and the reference findings |
| `rules/<name>/` | A snapshot of each rule set a result used |
| `scripts/run.ts` | Runs, scores and writes one result |
| `scripts/score.ts` | The scorer; also scores one result file on its own |
| `scripts/table.ts` | Prints the comparison table and writes `RESULTS.md` |
| `scripts/merge.ts` | Composes a hybrid result from two runs |
| `scripts/convert.ts` | Converted the runs made before this folder existed |
| `scripts/lib.ts` | Keys, rule loading, the three providers, the result format |
| `scripts/agy.toml` | agy's provider block from SPEC §9.3 |
| `scripts/agy.test.ts` | Checks the block and the command line the runner builds from it |
| `results/<date>-<label>.json` | One result per run |
| `results/raw/` | Model replies of new runs, and the original scratch runs and scripts |
| `results/app-runs.md` | Timings measured in the real app |
| `judge/` | An Opus judge's verdicts on unmatched findings |

## The corpus

Four drafts carry reference findings:

| Draft | Words | Paragraphs | Reference items |
|---|---|---|---|
| `draft-essay.md` | 545 | 9 | 18 |
| `draft-memo.md` | 541 | 9 | 17 |
| `draft-story.md` | 499 | 10 | 17 |
| `on-writing.md` | 208 | 8 | 30 |

That is 82 reference items over nine passes.

The essay, memo and story were written for the benchmark. Each has an answer
key, `key-<draft>.json`. The key lists planted problems and decoys. A decoy is
text that looks like a problem and is not one, such as "transmission" as the
name of a car part. `on-writing.md` is the author's test draft from the app. It
has no key, so it has no decoys.

The reference findings, `gold-<draft>.json`, were written by Opus subagents.
Each applied the pass rules to one draft. The files date from two minutes after
the rules were rewritten, so they follow the rewritten rules. The scorer uses
the answer keys for decoys only.

`long.md` (926 words) and `chapter.md` (5,032 words) have no reference. They
measure latency and cost only. `chapter.md` is longer than one window of
16,000 characters.

## Rule sets

A result names the rule set it ran. The prompts are what the model reads, so a
score is valid only for its rule set. Never edit a snapshot in place. Copy it
to a new name and change the copy.

| Name | What it is |
|---|---|
| `2026-09-23-starters` | The starter templates before the rewrite. No result uses them yet. |
| `2026-09-23-rewrite-docflow` | The rewrite with topic flow at document scope. Results A to P used it. |
| `2026-09-23-outline` | `rewrite-docflow` with an outline before the JSON in three document passes. Run X2 used it; it is kept in `results/raw/` only. |
| `2026-09-23-rewrite` | The rules the app ships (commit fcf6ec4). Topic flow at paragraph scope; paragraph order sets `thinking = "high"`. Results X3, R and the smoke test used it. |

`2026-09-23-rewrite-docflow` is reconstructed. The rules at the time of those
runs were not saved. The reconstruction is `2026-09-23-rewrite` with topic
flow at document scope, which matches the saved outline variant with its
outline lines removed.

A pass's frontmatter can set `thinking` and `timeout_secs`. The benchmark
reads both, as the app does. It ignores `provider`.

## Pipelines

| Pipeline | What happens |
|---|---|
| `plain` | Every pass runs at `--thinking`. Findings are kept as returned. |
| `fast` | Every pass runs at `--thinking`. Code drops quotes from outside the examined paragraph and repeats. Then three verifiers vote, and a candidate stays with two keeps. |
| `hybrid` | As the app runs. A pass whose rule file sets `thinking` uses that level and keeps its findings as returned. Every other pass runs as in `fast`. Passes that think are queued first. |

The verifiers use the same model and thinking level as the pass.

## Scoring

A finding matches a reference item of the same pass when their spans in the
draft overlap. Topic flow matches within one sentence. Paragraph order and
length match within one paragraph. Matching is one to one, so a second finding
on the same item is a false positive. A quote that is not in the draft is a
false positive and counts as unanchored. A decoy hit is a false positive on a
decoy's span.

F1, precision and recall are totals over all scored items. They are not means
of per-draft or per-pass scores. A result file holds the scores per pass and
per draft as well.

## Running

Keys come from the repo's `.env`, then from `~/.writegood/.env`:
`DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY`. The scripts never print a key.

The configuration the app ships, on the four scored drafts:

```
bun bench/scripts/run.ts --provider deepseek --model deepseek-flash \
  --thinking off --rules 2026-09-23-rewrite --pipeline hybrid --label flash-hybrid
```

`--passes a,b` runs only those passes, and `--skip a,b` runs all but those.
Add `--dry` to print the plan without calling a model. Then rebuild the table:

```
bun bench/scripts/table.ts
```

`run.ts` writes `results/<date>-<label>.json` and refuses to overwrite one.
It also writes every model reply to `results/raw/<date>-<label>.replies.json.gz`.

To score one result again, or to list its unmatched findings for a judge:

```
bun bench/scripts/score.ts bench/results/2026-09-23-R-1.json --by-pass --dump /tmp/unmatched.json
```

To measure one model for the fast passes and another for paragraph order,
run each part on its own, then compose them:

```
bun bench/scripts/run.ts --provider openrouter --model deepseek/deepseek-v4.1-flash \
  --thinking off --pipeline fast --skip paragraph-order --label or-dsflash-fast-1
bun bench/scripts/run.ts --provider openrouter --model google/gemini-3.8-flash \
  --thinking low --pipeline plain --passes paragraph-order --label or-po-gemini-low-1
bun bench/scripts/merge.ts --label H-dsflash-gemlow-1 \
  --base bench/results/2026-09-23-or-dsflash-fast-1.json \
  --take bench/results/2026-09-23-or-po-gemini-low-1.json
```

The composed wall is the slower part, and first findings are the base run's.

## Results by date

- `results/2026-09-23-openrouter.md`: nine OpenRouter models for the fast
  passes and for paragraph order, and the hybrids they make.

## Adding a model

Through OpenRouter, name the model as OpenRouter lists it:

```
bun bench/scripts/run.ts --provider openrouter --model openai/gpt-5-mini \
  --thinking low --rules 2026-09-23-rewrite --pipeline hybrid --label gpt5-mini-low
```

- Every call is pinned to one upstream provider, with fallbacks off:
  `provider: {only: [<slug>], allow_fallbacks: false}`. The default is the
  model's own vendor: `deepseek/…` goes to `deepseek`, `openai/…` to `openai`,
  `google/…` to `google-ai-studio`. `--or-provider <slug>` sets another.
  The table in `lib.ts` lists the vendors it knows. For any other vendor,
  pass `--or-provider`.
- Check that the pinned provider serves the model first:
  `curl -s https://openrouter.ai/api/v1/models/<vendor>/<model>/endpoints`.
  On 23 September 2026, `deepseek/deepseek-v4-flash` had no DeepSeek
  endpoint on OpenRouter; `deepseek/deepseek-v4.1-flash` had one.
- `--thinking` maps to OpenRouter's `reasoning` parameter. `off` sends
  `{"enabled": false}`. `low`, `medium`, `high` and `max` send
  `{"effort": <level>}`. `default` sends nothing. `none` sends
  `{"effort": "none"}`, which turns reasoning off on OpenAI and Inception
  models. `on` sends `{"enabled": true}`, for models with no effort levels.
  `none` and `on` are OpenRouter's. With DeepSeek or agy, `run.ts` refuses
  them before any call.
- `--cache-control` marks the system prompt and the shared head of each
  prompt with `cache_control` breakpoints. Alibaba caches only what a
  breakpoint marks.
- Cost is the `usage.cost` that OpenRouter reports for each call. Each call
  records the provider that served it, as the response names it.

Through DeepSeek directly, `--thinking off` sends `thinking: {"type":
"disabled"}`, and any other level sends `thinking: {"type": "enabled"}` with
`reasoning_effort`. Cost comes from the price table in `lib.ts`, which copies
the app's rates. A new DeepSeek model needs its rates added there.

Through agy, Google's Antigravity CLI, on the author's Google AI plan:

```
bun bench/scripts/run.ts --provider agy --model gemini-3.8-flash \
  --thinking off --agy-limit 8 --rules 2026-09-23-rewrite --pipeline hybrid --label agy-flash38-hybrid-1
```

- Each call goes through the app's own runner, `runner::cli_run`, by way of
  `src-tauri/examples/cli.rs`. The runner reads the `[providers.agy]` block
  in `scripts/agy.toml`, which is the block from SPEC §9.3. It builds the
  command line, runs agy in a new empty directory, writes the custom agent
  with no tools and the hook that denies every tool, and applies the timeout.
  The first call builds the example with cargo.
- `--model`, the thinking level and the ceiling replace the block's `model`,
  `thinking` and `timeout_secs`, as a pass's settings do in the app.
- The thinking level picks agy's model variant through `thinking_names`:
  `off` and `low` take `gemini-3.8-flash-low`, `medium` takes `-medium`, and
  `high` and `max` take `-high`.
- `bun test bench` checks that `agy.toml` matches SPEC §9.3 and the example
  in the app's default config, and that the runner builds the command line and
  files that SPEC §9.3 gives. A fake command stands in for agy.
- `--agy-limit` bounds the calls in flight across all four drafts. At 16,
  agy returned rate-limit errors; at 8 it did not.
- Cost is $0. Each call records `serviceSecs`, the time agy took without the
  wait for a slot.

To compare a model fairly, run it at least twice. Keep `--limit`, `--votes`
and `--need` at their defaults unless the change under test is one of them.

## Limits

- 82 reference items is a small sample. One item is 1.2 points of recall.
- Repeat runs of one configuration differed by up to five F1 points. Compare
  means of several runs, not single runs.
- The document passes have five or six reference items each: paragraph order
  6, length 6, topic flow 5. Their per-pass scores move by 15 points or more
  on one finding.
- The reference is one model's reading of the rules. The judge found 22 valid
  problems among 62 findings it missed. `judge/README.md` has the numbers.
- All four scored drafts fit in one window, so the scores say nothing about
  windows. `chapter.md` exercises windows, but it has no reference.
- A run with fewer drafts is scored on those drafts only. Its score is not
  comparable with a four-draft score. The smoke test is one such run.
- Latency varies with the provider's load. In one hour, the fast pipeline's
  wall per draft ranged from 4.9 to 8.6 seconds.
- A system prompt starts with a run id, so one run never reads another run's
  prompt cache. The app does not add it.

## The converted results

Results dated 2026-09-23, other than the smoke test, were made with the
scratch harness in `results/raw/scratch-scripts/` and converted by
`convert.ts`. Their scores were recomputed by `score.ts`. Three differences
apply to them:

- Verifier calls were not recorded one by one. Each draft records their total
  cost and time only.
- The code filters and the verifier were the scratch versions. The app's
  `filter.ts` and `verify.ts` copy them.
- R-1 and R-2 are composed. Eight passes come from X3-tf-para-1 or -2. Paragraph
  order comes from a separate run with thinking high. Wall is the slower of the
  two parts; first findings is the wall of the fast part.
