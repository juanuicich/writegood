# Five free models on OpenCode Zen

24 September 2026. Rule set `2026-09-23-british`, which matches
`src-tauri/passes`. The baseline is the setup in use, `british-1` to `-4`
(`2026-09-23-british.md`): the fast passes on DeepSeek Flash direct with
thinking off and the verifier, paragraph order on DeepSeek at high, filler
words on Jev (`jev-1.13.0`) on TypeSafe. Its mean F1 is 75.5%.

Two of the five models ran. Zen refused the other three from outside
OpenCode. A later test ran those three through the `opencode` CLI; see
"The three refused models, through the OpenCode CLI" below.

## OpenCode Zen

Zen is OpenCode's model gateway (https://opencode.ai/docs/zen/).

- Base URL `https://opencode.ai/zen/v1/`. Auth is
  `Authorization: Bearer <key>`. `GET /models` lists 42 models, and it
  lists all five ids.
- Each model takes one API shape. Chat models use `chat/completions`,
  `responses` or `messages`. Jev uses `systemone`, TypeSafe's decision API.
- The docs state no rate limits. No call here returned 429.
- By default, Zen's providers keep no data and do not train on it. The docs
  list exceptions, and four of the five models here are exceptions (below).
- The free models are free "for a limited time".

The five models:

| Id | Maker | Endpoint | Terms on the free tier | Result |
|---|---|---|---|---|
| `jev-1.13-free` | TypeSafe | `systemone` | No exception listed, so no retention and no training | Ran: filler words, through the app's Jev path |
| `space-bunny-free` | Not named: a "stealth model" | `chat/completions` | No retention, no training | Ran: all nine passes, through the app's client |
| `mimo-v2.6-flash-free` | Xiaomi | `chat/completions` | Data may be used to improve the model | Refused |
| `nemotron-3.5-lightning-free` | NVIDIA | `chat/completions` | NVIDIA trial endpoint: calls are logged; no personal or confidential data | Refused |
| `muse-spark-1.3-contributor-free` | Meta | `responses` only | Prompts and completions train future Meta models. "Contributor" names this trade. | Refused |

The three refusals all gave the same error, with and without the thinking
field:

```
{"type":"error","error":{"type":"FreeTierError",
 "message":"OpenCode's free tier can only be used from within OpenCode"}}
```

The instruction was to call Zen directly as an `openai-compatible` provider,
not through the OpenCode CLI. So these three were not benchmarked. Muse Spark
takes only the `responses` API. The app's `openai-compatible` kind sends
`chat/completions`, so the app could not call it in any case.

`jev-1.13-free` is Jev, not a chat model. Its `chat/completions` call gave the
same `FreeTierError`. Its `systemone` call answered. The app's `jev` provider
takes a `base_url`, so it ran as the app runs it.

Space Bunny always reasons. It returns its reasoning in `reasoning_content`.
It rejects `thinking: {"type": "disabled"}`, which the app sends for `off`,
and `reasoning_effort: "none"`, with "invalid request". It takes `minimal`,
`low` and `high`. The app's lowest level that it takes is `low`, so the fast
passes ran at `low`.

## How it was run

The blocks are in `bench/scripts/opencode-zen.toml`. The key is
`env:OPENCODE_ZEN_API_KEY`.

```
bun bench/scripts/run.ts --provider app --block bench/scripts/opencode-zen.toml \
  --block-name zen-bunny --thinking low --pipeline fast --skip paragraph-order \
  --rules 2026-09-23-british --app-limit 8 --label zen-bunny-fast-1
bun bench/scripts/run.ts --provider app --block bench/scripts/opencode-zen.toml \
  --block-name zen-bunny --pipeline hybrid --passes paragraph-order \
  --rules 2026-09-23-british --app-limit 8 --label zen-bunny-po-1
bun bench/scripts/merge.ts --label zen-bunny-1 \
  --base bench/results/2026-09-24-zen-bunny-fast-1.json \
  --take bench/results/2026-09-24-zen-bunny-po-1.json
bun bench/scripts/run.ts --provider jev --block bench/scripts/opencode-zen.toml \
  --block-name zen-jev --pipeline hybrid --passes filler-words \
  --rules 2026-09-23-british --label zen-jev-fw-1
```

- Paragraph order ran at `high`, the level its rule file sets, as the
  baseline did.
- The fast passes ran three times, at three limits on calls in flight: 8
  across the four drafts (`fast-1`), 32 across the four (`fast-2`), and 32
  per draft (`fast-128`), as the app and the DeepSeek baseline run.
- `zen-bunny-jev-1`, `-2` compose Space Bunny with Jev for filler words, the
  shape of the setup in use.

## Space Bunny

F1 per pass. The baseline is the mean of `british-1` to `-4`.

| Pass | Items | Baseline mean | zen-bunny-1 | zen-bunny-2 | Mean | Change | fast-128 |
|---|---|---|---|---|---|---|---|
| filler-words | 18 | 81.4% (Jev) | 73.7% | 68.4% | 71.1% | −10.3 | 71.8% |
| length | 6 | 41.4% | 54.5% | 61.5% | 58.0% | +16.6 | 50.0% |
| nominalization | 14 | 90.2% | 69.2% | 72.0% | 70.6% | −19.5 | 59.3% |
| paragraph-order | 6 | 86.8% | 80.0% | 72.7% | 76.4% | −10.4 | |
| passive-actor | 10 | 54.7% | 57.1% | 66.7% | 61.9% | +7.2 | 46.2% |
| repeated-phrasing | 11 | 81.1% | 63.2% | 55.6% | 59.4% | −21.8 | 40.0% |
| sentence-openings | 5 | 80.4% | 88.9% | 88.9% | 88.9% | +8.5 | 88.9% |
| topic-flow | 5 | 40.8% | 57.1% | 66.7% | 61.9% | +21.2 | 75.0% |
| unearned-metaphor | 7 | 81.4% | 60.0% | 50.0% | 55.0% | −26.4 | 25.0% |
| **All passes, F1** | 82 | **75.5%** | 68.1% | 66.7% | **67.4%** | **−8.1** | |
| All passes, precision | | 75.2% | 79.0% | 73.5% | 76.3% | +1.1 | |
| All passes, recall | | 75.9% | 59.8% | 61.0% | 60.4% | −15.5 | |

| | fast-1 | fast-2 | fast-128 | Baseline (`british-ds`) |
|---|---|---|---|---|
| Calls in flight | 8 across drafts | 32 across drafts | 32 per draft | 32 per draft |
| Fast F1, eight passes | 67.2% | 66.2% | 59.5% | 74.5% mean (filler words on Jev) |
| Fast F1, seven passes (no filler words) | 64.6% | 65.3% | 54.3% | 71.6% mean |
| Fast passes done, per draft | 246 to 340 s | 64 to 100 s | 45 to 161 s | 4.6 to 7.6 s |
| Call time, median | 81 s | 18 s | 4.4 s | 1.4 s |
| Calls | 346 | 343 | 343 | 308 |
| Timeouts at 100 s | 1 | 0 | 1 | 0 |
| Unreadable replies | 2 | 2 | 3 | 1 in four runs |
| Rate limits | 0 | 0 | 0 | 0 |
| Cost per draft | $0 | $0 | $0 | $0.021 to $0.022 |

Paragraph order, at `high`:

| | zen-bunny-po-1 | zen-bunny-po-2 | DeepSeek high (`british-ds-1` to `-4`) | agy low (`agy-po-low-1`, `-2`) |
|---|---|---|---|---|
| PO F1 | 80.0% | 72.7% | 76.9% to 92.3% | 80.0%, 85.7% |
| Precision, recall | 100%, 66.7% | 80.0%, 66.7% | 71–86%, 83–100% | 66.7–75.0%, 100% |
| Per draft | 8.3 to 25.2 s, mean 16.7 s | 20.9 to 88.1 s, mean 40.6 s | 36 to 49 s | 6.2 s, 9.3 s |
| Output tokens per call | 1,864 | 4,558 | about 9,900 | 232, 1,568 |
| Cost per draft | $0 | $0 | $0.0055 to $0.0073 | $0 |

- Overall F1 is 8.1 points below the baseline, above the 4.5 points that two
  runs put at noise. Recall is the loss: 60% against 76%. Precision is the
  same.
- It loses most on unearned metaphor, repeated phrasing and nominalization,
  which have 7 to 14 items each. It gains on topic flow, length and sentence
  openings, which have 5 or 6 items each.
- The third run, with 32 calls in flight per draft, scored 7 to 8 points
  below the first two. It is the only run with that limit, so this test
  cannot tell whether the limit or chance caused the drop.
- Calls are slow. With 32 in flight per draft, the median call took 4.4
  seconds, the 90th percentile 13 to 20 seconds, and the slowest 100
  seconds. A draft's fast passes took 45 to 161 seconds, against about 6 on
  DeepSeek.
- Every unreadable reply was a verifier reply with no verdicts. Each run
  lost two or three. Each timeout was one call, at 100 seconds.
- The app reports no reasoning tokens for this route. The fast calls wrote
  about 400 output tokens each, against about 200 on DeepSeek.
- With filler words on Jev, as in the setup in use, Space Bunny scored 70.7%
  and 70.5% (`zen-bunny-jev-1`, `-2`), 4.9 points below the baseline.

## Jev 1.13 Free

Filler words, method `sentence`, keep 0.5, through the app's `jev.ts` and
`jev::ask`, with `base_url = "https://opencode.ai/zen/v1"`.

| | zen-jev-fw-1 | zen-jev-fw-2 | `jev-1.13.0` on TypeSafe (`british-jev-1` to `-4`) |
|---|---|---|---|
| Filler words F1 | 81.8% | 81.8% | 81.8, 80.0, 81.8, 81.8% |
| Precision, recall | 69.2%, 100% | 69.2%, 100% | 67–69%, 100% |
| Per draft | 7.1 to 9.9 s | 6.6 to 9.7 s | 6.6 to 9.9 s |
| Requests, errors | 82, 0 | 82, 0 | 82 or 83, 0 |
| Cost per draft | $0 | $0 | $0.0023 |

The response names the model `jev-1.13-free`. It scores and times as
`jev-1.13.0` does. Both runs kept the same findings as three of the four
TypeSafe runs.

## Combined

| Setup | Runs | F1 | Fast passes done, per draft | Cost per draft |
|---|---|---|---|---|
| Baseline: DeepSeek, PO DeepSeek high, filler words Jev | `british-1` to `-4` | 70.9, 80.0, 75.6, 75.4% (mean 75.5%) | 4.6 to 7.6 s | $0.023 to $0.025 |
| Space Bunny for all nine passes | `zen-bunny-1`, `-2` | 68.1, 66.7% (mean 67.4%) | 64 to 340 s | $0 |
| Space Bunny, filler words on Jev Free | `zen-bunny-jev-1`, `-2` | 70.7, 70.5% (mean 70.6%) | 64 to 340 s | $0 |
| Paragraph order alone, Space Bunny high | `zen-bunny-po-1`, `-2` | PO 80.0, 72.7% | 8 to 88 s | $0 |
| Filler words alone, Jev Free | `zen-jev-fw-1`, `-2` | FW 81.8, 81.8% | 6.6 to 9.9 s | $0 |

## Conclusions

- Space Bunny, fast passes: 7 to 8 points below DeepSeek. With 32 calls in
  flight per draft, a draft's fast passes took 45 to 161 seconds, against
  about 6 on DeepSeek. Not worth using.
- Space Bunny, paragraph order: 80.0% and 72.7%, within noise of DeepSeek
  high but below it in both runs. agy low and Gemini low are as good and
  faster. Not worth using.
- Jev 1.13 Free: the same scores and times as the paid `jev-1.13.0`, at $0,
  with no data kept. It saves about $0.002 a draft while the free period
  lasts.
- MiMo V2.6 Flash, Nemotron 3.5 Lightning and Muse Spark 1.3 Contributor:
  not measured here. Zen serves their free tier only to OpenCode. The
  section below measures them through the `opencode` CLI.

## Recommendation

Keep the setup in use. Space Bunny scores lower on the fast passes and is far
slower. For paragraph order it gives no gain over DeepSeek high, agy low or
Gemini low. It is also a stealth model on a limited-time offer.

For filler words, `jev-1.13-free` is a free substitute for `jev-1.13.0`. The
saving is small, and the docs give no end date for the free period. To use
it, point the `jev` provider at Zen:

```toml
[providers.jev]
kind          = "jev"
base_url      = "https://opencode.ai/zen/v1"
model         = "jev-1.13-free"
key_ref       = "env:OPENCODE_ZEN_API_KEY"
max_in_flight = 8
price         = { input = 0, output = 0 }
```

## The three refused models, through the OpenCode CLI

24 September 2026, later the same day. The same rule set and baseline. The
three models ran through `opencode run` 1.18.30, as a `cli` provider through
the app's runner. This is a benchmark only. The app's default config does
not name opencode.

These models log prompts or train on them. Muse Spark "Contributor" trains
Meta models on prompts and replies. They received only the drafts in
`bench/corpus`.

### How opencode was called

The block is `bench/scripts/opencode.toml`, as `--provider cli` (see
`bench/README.md`). Each call goes through `runner::run` by way of
`src-tauri/examples/cli.rs`, so the command line, the empty directory, the
files and the timeout are the app's.

- The command is `env`, which sets four variables and runs
  `opencode run --model opencode/<id> --variant <level> --agent writegood
  --title writegood -- <prompt>`. The reply is plain text on stdout. Tool
  calls and errors go to stderr.
- `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` point into the
  empty directory. opencode then reads none of the author's config, plugins,
  MCP servers, skills in its config folder, sessions or credentials, and
  keeps no session after the call. The free models need no login.
  `OPENCODE_DISABLE_CLAUDE_CODE=1` stops it reading `~/.claude`.
- `PWD` is set to the directory too. The runner sets the working directory
  but not `PWD`, and opencode read the inherited `PWD`: every call failed
  with "Unexpected server error" until the block set it.
- `--title` skips the extra call that names the session.
- `--variant` sets Muse Spark's reasoning effort: `off` maps to `minimal`,
  `high` to `high`. MiMo and Nemotron have no variants and ignore it.

A request captured at a local server held the agent's one-line prompt, the
working directory, the platform and the date, and the prompt. It held no
file, rule or skill of the author's.

### How tools were turned off

Zen refuses a free-tier request that carries no tools. With every tool
denied, or every tool but one, it returned the same `FreeTierError` as
before. So the tools stay in the request (`bash`, `edit`, `glob`, `grep`,
`read`, `task`, `todowrite`, `webfetch`, `websearch`, `write`, about 5,600
input tokens), and two guards stop every call:

- `opencode.json` in the directory sets every permission to `ask`, and
  denies `skill`, which removes the skill list from the request.
  `opencode run` rejects each ask unless it gets `--auto`.
- A plugin in `.opencode/plugins/` throws "Tools are off." before any tool
  runs, and answers every permission ask with deny.

Tests, with a prompt that asked for `echo hi > shell_marker.txt`, a
`touch` outside the directory, a file write and a read of `~/.zshrc`:

- Permissions alone: opencode rejected each call. No file appeared.
- The plugin alone, with every permission set to allow: every call failed
  with "Tools are off.". No file appeared.
- Both, through the runner, on all three models: every call failed. MiMo and
  Muse said so in words. The directory held only the files the runner wrote.

The benchmark counts a reply as an error if stderr shows a tool call. No
benchmark call showed one.

### Start-up time

With a local fake model that answers at once, a call through the runner took
2.9 to 3.4 seconds: 2.5 to 2.9 seconds before the request, 0.5 seconds after
the reply. Each call used about 5 seconds of CPU time. agy adds about 2
seconds a call.

### Runs

Eight fast passes at the lowest level, with the verifier. Paragraph order at
`high`. `--cli-limit` bounds the calls in flight across the four drafts.

| Run | Model | Calls in flight | F1 | P | R | Per draft | Calls | Errors | Unreadable |
|---|---|---|---|---|---|---|---|---|---|
| `zen-muse-fast-1` | Muse Spark, minimal | 4 | 68.8% | 67.9% | 69.7% | 1,187 to 1,430 s | 340 | 1 timeout | 0 |
| `zen-muse-fast-8` | Muse Spark, minimal | 8 | 65.2% | 56.9% | 76.3% | 1,453 to 2,058 s | 331 | 92 timeouts, 8 rate limits | 0 |
| `zen-mimo-fast-1` | MiMo V2.6 Flash | 4 | 37.8% | 60.0% | 27.6% | 4,527 to 5,337 s | 301 | 168 timeouts, 4 rate limits | 6 |
| `zen-nemotron-fast-1` | Nemotron 3.5 Lightning | 4 | 0.0% | | | 3,794 to 5,994 s | 256 | 217 timeouts | 14 |
| `zen-nemotron-fast-2` | Nemotron 3.5 Lightning | 4 | 0.0% | | | 3,761 to 5,973 s | 256 | 210 timeouts | 17 |
| `zen-nemotron-po-1`, `-2` | Nemotron 3.5 Lightning | 4 | PO 0.0% | | | 303 s | 4 each | 4 timeouts at 300 s, each run | 0 |

- The runs overlapped. The first Muse, MiMo and Nemotron fast runs ran at
  the same time, 12 calls in flight in all, and `zen-muse-fast-8` ran while
  the MiMo and Nemotron runs were still going.
- A timeout is a call that did not end within 100 seconds, or 300 for
  paragraph order. opencode retries a rate-limited request itself and prints
  nothing, so a rate limit shows as a timeout. Logs of calls in flight showed
  "Rate limit exceeded" for MiMo and Muse, and no error for Nemotron.
- In `zen-muse-fast-8` and `zen-mimo-fast-1`, every verifier call failed. A
  candidate with no verdict is kept, so both runs are close to unverified.
- The table records no tokens. opencode's plain output has none. A test call
  with `--format json` reported 5,667 input tokens for a one-line prompt.

### Muse Spark 1.3

F1 per pass in `zen-muse-fast-1`, against the baseline mean:

| Pass | Items | Baseline mean | zen-muse-fast-1 | Change |
|---|---|---|---|---|
| filler-words | 18 | 81.4% (Jev) | 77.8% | −3.6 |
| length | 6 | 41.4% | 40.0% | −1.4 |
| nominalization | 14 | 90.2% | 72.0% | −18.2 |
| passive-actor | 10 | 54.7% | 62.5% | +7.8 |
| repeated-phrasing | 11 | 81.1% | 54.1% | −27.0 |
| sentence-openings | 5 | 80.4% | 100% | +19.6 |
| topic-flow | 5 | 40.8% | 75.0% | +34.2 |
| unearned-metaphor | 7 | 81.4% | 83.3% | +1.9 |
| **Eight fast passes** | 76 | **74.5%** | **68.8%** | **−5.7** |

- It is 5.7 points below the baseline's fast passes, in one run. Space Bunny
  scored 67.2% and 66.2% on the same passes.
- Repeated phrasing drew 16 false positives, and nominalization lost 5
  items. The gains are on passes with 5 to 10 items.
- A call took 12.2 seconds (median) and 31.7 seconds at the 90th
  percentile, without the wait for a slot. A draft's fast passes took 20 to
  24 minutes with 4 calls in flight across four drafts. DeepSeek takes about
  6 seconds.
- With 8 in flight, Zen rate-limited it (`zen-muse-fast-8`). After that,
  every Muse call failed for more than two hours. Four paragraph-order calls
  at `high` all timed out at 300 seconds, and a one-line probe every five
  minutes from 16:39 to 18:42 never got a reply. The second fast run and
  both paragraph-order runs could not be made.

### MiMo V2.6 Flash

One run, 37.8% F1. More than half the calls failed, mostly on rate limits,
and every verifier call failed. The score says little about the model. Its
successful calls took 18.5 seconds (median). Rate limits then blocked it for
more than two hours, as for Muse, so the second run and paragraph order
could not be made.

### Nemotron 3.5 Lightning

Two runs, 0.0% F1 both. 85% of calls did not end within 100 seconds, and
every paragraph-order call ran past 300 seconds. No call reported a rate
limit. A one-line prompt took 75 seconds. Of 85 replies in the two runs,
31 held no JSON array, and the rest held no finding. One reply ended in a
`</tool_call>` tag, and one described the English draft as
"Persian/Arabic". With no candidates, no verifier call ran.

### Comparison

| Setup | Runs | Fast F1 (eight passes) | PO F1 | Fast passes per draft |
|---|---|---|---|---|
| Baseline: DeepSeek, filler words on Jev | `british-1` to `-4` | 70.2, 79.3, 75.2, 74.0% (mean 74.5%) | DeepSeek high 76.9–92.3%; agy low 80.0, 85.7% | 4.6 to 7.6 s |
| Space Bunny, low | `zen-bunny-fast-1`, `-2` | 67.2, 66.2% | 80.0, 72.7% | 64 to 340 s |
| Muse Spark 1.3, minimal | `zen-muse-fast-1` | 68.8% | not measured: rate-limited | 1,187 to 1,430 s |
| MiMo V2.6 Flash | `zen-mimo-fast-1` | 37.8%, most calls failed | not measured: rate-limited | 4,527 to 5,337 s |
| Nemotron 3.5 Lightning | `zen-nemotron-fast-1`, `-2` | 0.0, 0.0% | 0.0, 0.0% (all timed out) | 3,761 to 5,994 s |

### Conclusions

- Muse Spark 1.3: 68.8% on the fast passes in one run, 5.7 points below the
  baseline and level with Space Bunny. Calls take 12 seconds each, and Zen
  rate-limits it at 8 in flight and then for hours. Its free tier trains on
  the text. Not worth using.
- MiMo V2.6 Flash: rate limits decided the one run. Not measured fairly.
- Nemotron 3.5 Lightning: too slow to finish a call in 100 seconds, and its
  replies rarely parse. Not usable.
- The opencode CLI adds about 3 seconds and 5,600 input tokens to every
  call. Zen's free tier needs the tool list in the request, so tools can
  only be blocked, not removed.

### Files

- `scripts/opencode.toml`: the `cli` block.
- `zen-muse-fast-1`, `zen-muse-fast-8`, `zen-mimo-fast-1`,
  `zen-nemotron-fast-1`, `-2`, `zen-nemotron-po-1`, `-2`: the runs.
- `raw/2026-09-24-zen-{muse,mimo,nemotron}-*.replies.json.gz`: the replies.

## Files

- `scripts/opencode-zen.toml`: the provider blocks.
- `zen-bunny-fast-1`, `-2`, `-128`: Space Bunny, eight fast passes.
- `zen-bunny-po-1`, `-2`: Space Bunny, paragraph order.
- `zen-bunny-1`, `-2`: the two composed.
- `zen-jev-fw-1`, `-2`: filler words on Jev Free.
- `zen-bunny-jev-1`, `-2`: `zen-bunny-N` with filler words from `zen-jev-fw-N`.
- `raw/2026-09-24-zen-*.replies.json.gz`: the replies.
