# Benchmarks

What I measured about models for the passes, what I use now, and what else
works. Every number here comes from a file in [`bench/results/`](./bench/results/)
or from [`DEVLOG.md`](./DEVLOG.md). All of it was measured on 23 September
2026, on four short drafts. Read the limits before you trust a decimal point.

## Why

The first setup ran every pass with thinking on. DeepSeek Flash took two to
three minutes to review a 500-word draft (`B-flash-high`, 146 to 171 seconds).
DeepSeek Pro with thinking high took almost ten minutes (`A-pro-high-300`,
586 seconds).

The goal was passes that answer in seconds and cost a few cents for a
chapter, with no loss of quality. Each experiment answered one question.

**Rewrite the starter rules.** A fast model flags too much. Each rule now
states a test, what not to flag, the exact span to quote, what each severity
means and what the note may say. The "do not flag" lists carry most of the
weight. The rules live in `src-tauri/passes/`.

**Turn thinking off and add a verifier.** With thinking off, DeepSeek Flash
finds nearly everything and flags twice as much that is wrong: F1 43%
(`C-flash-off`). Code filters and three verifier votes bring it to 64–65%.
Paragraph order keeps thinking on, and the whole run then scores 71–72%, the
same as thinking on for every pass. First findings arrive in about six
seconds instead of two to three minutes. A run costs about a sixth as much.

**Send windows, save answers.** With the whole draft in every call, input
grows with the square of the draft's length. A 5,000-word chapter sent about
3.4 million tokens. Windows make it grow in line with the length. Saved
answers mean a rerun asks only about the paragraphs you changed. In the real
app, a chapter took about 25 seconds the first time, about 3 seconds after
editing one paragraph, and 1.5 seconds with no calls when nothing changed
(`app-runs.md`). Windows did not lower the score on a joined draft of 18,000
characters: 68.9% in windows, 68.0% sent whole (`2026-09-23-gaps.md`).

**Run the calls in parallel.** The app keeps up to 32 calls in flight. A pass
takes about as long as its slowest call, not the sum of its calls. A call
with thinking off answers in one or two seconds.

**Try newer inexpensive models.** Nine models through OpenRouter, each pinned
to its vendor's own provider with fallbacks off. OpenRouter's providers for
one model differ in quality, so an unpinned score says little about the
model. Results in `2026-09-23-openrouter.md` and `2026-09-23-followup.md`.

**Use a subscription.** agy runs Gemini on a Google AI plan. It costs nothing
per call and scored the highest F1 of any full run. It is also the slowest
route here.

**Try Jev.** TypeSafe's Jev answers a yes/no or multiple-choice question with
a probability. It cannot write text. The first attempt found candidates with
hand-written English word lists and scored well. That broke a rule of the
app: a pass's rule text must be its whole definition, and must work in any
language. The second attempt used the rule text alone. Results in
`2026-09-23-jev.md`, `2026-09-23-jev-nolist.md`, section 4 of
`2026-09-23-followup.md` and `2026-09-23-jev-across.md`.

## How it is measured

[`bench/README.md`](./bench/README.md) has the details. In short:

- Four drafts: an essay, a memo and a story written for the benchmark, and
  the app's own test draft. 208 to 545 words each.
- 82 reference findings over the nine passes. Opus wrote them, applying the
  rewritten rules to each draft.
- The essay, memo and story also carry decoys: text that looks like a problem
  and is not, such as "transmission" as the name of a car part.
- A finding matches a reference item of the same pass when their spans
  overlap. Paragraph order and length match within a paragraph. A quote that
  is not in the draft counts as wrong.
- A judge reads the findings that matched nothing, because the reference
  misses real problems. "Precision after judging" counts the ones it accepts.
- Each run records time to first findings, time per draft and cost per draft.
- A 5,000-word chapter measures time and cost at length. It has no reference.

The limits:

- Four small drafts. One reference item is 1.2 points of recall.
- Runs of the same configuration differ. Four runs of the current setup
  scored 65.5% to 72.4% ("Baseline for rule changes", below). Most
  configurations here ran twice. Compare pairs, not single numbers.
- The reference is one model's reading of the rules. The judge found 22
  valid problems among 62 findings it had missed (`bench/judge/README.md`).
- Paragraph order has six reference items. One finding moves its score by
  15 points or more.
- The chapter is `SPEC.md`, written to the same rules the passes check. It has
  few problems. DeepSeek refused 20 calls on it, because the draft describes
  the passes themselves.
- All four scored drafts fit in one window. One test joins them, with
  unscored padding, into a draft of five windows. It ran twice each way, on
  six passes, so it would miss a loss of 5 points or less.

## The setup I use

DeepSeek Flash on DeepSeek's own API, thinking off, with the verifier, for the
eight fast passes. Gemini 3.8 Flash at low effort for paragraph order. With a
TypeSafe key, filler words runs on Jev instead ("Filler words on Jev", below).

| | F1 | First findings | Per draft | Cost per draft |
|---|---|---|---|---|
| This setup (`H-dsdirect-gemlow-1`, `-2`) | 71.1%, 71.3% | 5.9 s, 6.1 s | 6.2 s, 6.1 s | $0.0195, $0.0188 |
| Paragraph order on DeepSeek at high (`R-1`, `-2`) | 71.2%, 71.8% | 5.9 s, 6.1 s | 29.9 s, 39.7 s | $0.0215, $0.0225 |

The two score the same. The difference is paragraph order: about 3 seconds on
Gemini low, against 30 to 40 seconds on DeepSeek with thinking high. A draft
is complete in about 6 seconds. Gemini's paragraph-order score is lower, 80%
against 83–86%, which on six items is one finding.

On the chapter, the fast passes took about 25 seconds and cost 10 to 17 cents
in the app (`app-runs.md`; that cost includes paragraph order on DeepSeek).
Gemini low answered paragraph order on the chapter in 2.7 seconds for $0.007.
The app had taken 110 to 145 seconds for that pass.

Two caveats. The fast-pass half of these hybrids came from an earlier harness.
Two later runs of the same DeepSeek settings through the current harness
scored 68.5% and 62.4% on the eight fast passes, against 70.2% and 70.5%
(`2026-09-23-followup.md`, section 2). Two runs cannot tell whether that is
the harness or noise. And the Gemini numbers were measured through
OpenRouter, pinned to Google AI Studio. The app calls Google's API directly,
which has not been measured.

Through the app's own client, with OpenRouter as an `openai-compatible`
provider and no pinning, paragraph order on Gemini low scored 80% in two
runs, the same as pinned. It took about 4 seconds and $0.0025 a draft, and
4.1 seconds and $0.007 on the chapter. Every OpenRouter endpoint for this
model is Google's own, so an unpinned call reaches the same vendor. The
`base_url` must end with a slash: `"https://openrouter.ai/api/v1/"`. Without
it every call fails with 404 (`2026-09-23-gaps.md`, test 1).

The config:

```toml
default_provider = "deepseek"

[providers.deepseek]
kind     = "openai-compatible"
base_url = "https://api.deepseek.com/v1"
model    = "deepseek-flash"
key_ref  = "env:DEEPSEEK_API_KEY"
thinking = "off"

[providers.google]
kind     = "google"
model    = "gemini-3.8-flash"
key_ref  = "env:GEMINI_API_KEY"
```

And the frontmatter of `~/.writegood/passes/06-paragraph-order.md`:

```toml
+++
name = "Paragraph order"
category = "paragraph-order"
scope = "document"
enabled = true
provider = "google"
thinking = "low"
timeout_secs = 300
+++
```

A pass's `provider` sends that pass to a different provider. The provider
override in the header bar wins over it, and sends every pass to one
provider. The starter passes ship with paragraph order on the default
provider at thinking `high`, so this change is yours to make.

### Filler words on Jev

Filler words scores higher on Jev than on DeepSeek: 83.7% and 85.7%
against 74.3% and 68.4%, for about $0.002 a draft (the Jev section below).
To use it, add a `jev` provider to `config.toml`:

```toml
[providers.jev]
kind          = "jev"
model         = "jev-1.13.0"
key_ref       = "env:TYPESAFE_API_KEY"
max_in_flight = 8
price         = { input = 0.042, output = 0 }
```

Then add `provider = "jev"` to the frontmatter of
`~/.writegood/passes/04-filler-words.md`, above its `[jev]` table:

```toml
+++
name = "Filler words"
category = "filler-words"
scope = "paragraph"
provider = "jev"
enabled = true

[jev]
method = "sentence"
keep = 0.5
note = "A word or phrase that adds emphasis or hedging and no meaning."
+++
```

A home made before the Jev build has no `[jev]` table in this file. Add the
table as shown. `model` names a version, so a new release of Jev does not
change the answers without notice. `price` is there because models.dev does
not list TypeSafe; the app uses it only when the catalog has no price. The
provider override in the header bar sends a pass to Jev only when the pass
has a `[jev]` table.

### Baseline for rule changes

Use these numbers to judge a change to a rule. They are four runs on the
four scored drafts of this configuration: the fast passes on DeepSeek direct
with thinking off and the verifier, paragraph order on DeepSeek at high (the
starter setting, not Gemini), and filler words on Jev as the app runs it. Rule set `2026-09-23-shipped`
(`noise-1` to `-4`; `2026-09-23-gaps.md`, test 3).

| Pass | Items | Mean F1 | SD | Range |
|---|---|---|---|---|
| filler-words (Jev) | 18 | 79.3% | 5.0 | 71.8–81.8% |
| length | 6 | 54.2% | 11.7 | 40.0–66.7% |
| nominalization | 14 | 88.5% | 4.4 | 84.6–92.3% |
| paragraph-order | 6 | 80.2% | 5.1 | 75.0–85.7% |
| passive-actor | 10 | 56.3% | 6.1 | 50.0–63.6% |
| repeated-phrasing | 11 | 65.1% | 4.9 | 60.9–71.4% |
| sentence-openings | 5 | 71.5% | 19.2 | 44.4–88.9% |
| topic-flow | 5 | 30.0% | 11.4 | 19.0–44.4% |
| unearned-metaphor | 7 | 84.3% | 6.4 | 76.9–92.3% |
| **All passes** | 82 | **69.6%** | **3.1** | 65.5–72.4% |

SD is in F1 points. Precision averaged 64.6% and recall 75.6%. First
findings came in 4.3 to 5.5 seconds, and a draft cost $0.022 to $0.026.

- One run with nothing changed can land 4 points from the mean. Two runs
  differed by 7.
- Run a changed rule four times and compare the means. A difference under
  about 4.5 points on all passes is noise.
- A pass with five or six items moved 11 to 45 points between runs. A change
  to one of those rules needs more drafts than these four.
- Filler words scored 81.8% in three runs. The fourth lost one paragraph to
  a `503` from TypeSafe and scored 71.8%.

## Using a plan you already pay for

The `cli` backend runs a command-line tool you already have, on your
subscription rather than API credits. It saves money and costs time.

### agy, on a Google AI plan

agy is Google's Antigravity CLI. It is an agent: by default it has a shell,
file tools and your MCP servers, and it reads `GEMINI.md` and `AGENTS.md`.
Unguarded, it ran shell commands and wrote files. The block below turns that
off. Every call runs in a new, empty directory. The directory holds a custom
agent with no tools and a hook that denies every tool call. Keep both guards.

```toml
[providers.agy]
kind         = "cli"
command      = "agy"
model        = "gemini-3.8-flash"
thinking     = "off"          # runs as gemini-3.8-flash-low, with the verifier
thinking_names = { off = "low", max = "high" }
args         = ["-p", "{prompt}", "--agent", "writegood", "--add-dir", "{workdir}",
                "--model", "{model}-{thinking}", "--output-format", "json"]
json_path    = "response"
json_error   = "error"
timeout_secs = 180
max_in_flight = 8

[providers.agy.files]
".agents/agents/writegood/agent.md" = """
---
name: writegood
description: Answers one prompt from its text alone.
mainAgent: true
subagent: false
tools: []
inheritMcp: false
inheritCustomizations: false
excludeDefaultComponents: true
---
Answer the user's message from its text alone. You have no tools.
"""
".agents/hooks.json" = '''
{"writegood-no-tools": {"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command",
 "command": "echo '{\"decision\":\"deny\",\"reason\":\"Tools are off.\"}'", "timeout": 5}]}]}}
'''
```

`config.toml` carries the same block, commented out. Set
`default_provider = "agy"` to use it.

Measured on the four drafts, with paragraph order on `-high`
(`agy-flash38-hybrid-1`, `-2`):

- F1 78.6% and 77.5% with the verifier. Without it, 68–69%.
- $0 per call.
- A fast call takes about 4.6 seconds at the median, against one to two for
  DeepSeek. Each call starts a new agy process.
- Paragraph order on `-high` takes 80 to 125 seconds.
- 8 calls in flight gave no errors. 16 gave rate-limit errors.

With 8 calls in flight, one draft's 75 to 95 fast calls, verifier included,
take about a minute. That is an estimate from the call times. The benchmark
ran four drafts at once through the same 8 slots, so its times per draft (150
and 265 seconds) are longer than one draft alone would take.

So agy scores 6 to 7 points above the DeepSeek setup and costs nothing. It
takes about ten times as long for the fast passes, and paragraph order takes
about two minutes instead of three seconds.

agy also works as the duel judge. Set `judge_provider = "agy"` with a pass
provider from another vendor, such as DeepSeek. The test used two memo
paragraphs, each against a version with its reference problems fixed by hand.
Each pair went to the judge ten times, five in each order:

- The judge chose the fixed version in 20 of 20 calls. Swapping the sides did
  not change a verdict.
- No reply was unreadable, and no call failed.
- A call took about 4.5 seconds at the median, 3.8 to 8.2 in all.
- Every call ended in one turn. No call tried a tool.

Both pairs are easy cases: each fix removes problems that the passes flag.
The test says the judge runs and is steady. It does not say how the judge
does on two close versions.

### claude-cli, on a Claude plan

Not benchmarked. The block from the default config:

```toml
[providers.claude-cli]
kind    = "cli"
command = "claude"
args    = ["-p", "{prompt}", "--output-format", "json"]
json_path = "result"        # extract this field from stdout, then parse
thinking = "off"            # not in the command; the pass runs with the verifier
timeout_secs = 180
```

It also runs each call in an empty directory. It saves the API cost. Its
speed and its scores are not measured.

## Other results

Everything else tried. Two runs each unless one number is given. "Fast F1" is
the eight fast passes (76 reference items); "PO F1" is paragraph order alone
(6 items); "Run F1" is all nine passes. Every OpenRouter call was pinned to
the vendor's own provider.

### For the eight fast passes

| Model and route | Fast F1 | First findings | Cost per draft | Why it is not the default |
|---|---|---|---|---|
| DeepSeek v4.1 Flash, OpenRouter | 64.9%, 64.6% | 5.1 s, 5.7 s | $0.017, $0.016 | Same as DeepSeek direct within noise: means of 64.8% and 65.5% in the same harness. The app cannot pin an OpenRouter provider. |
| GPT-6 Luna, effort none | 62.7%, 64.3% | 9.6 s, 10.8 s | $0.014, $0.014 | Recall 49%. It returns `[]` for 77% of calls. On the chapter it kept no finding, and cost more than DeepSeek, with no cache reads. |
| GPT-6 Luna, effort low | 67.1%, 69.7% | 37.0 s, 28.7 s | $0.031, $0.030 | Recall recovers, precision falls to 67–68%. Twice the cost and five to seven times the time of DeepSeek. |
| Gemini 3.8 Flash, low, OpenRouter | 74.5%, 73.5% | 23.0 s, 24.0 s | $0.17, $0.18 | Highest F1 through an API, at 11 times DeepSeek's cost. No cache reads. 300 requests a minute, which a chapter's 900 calls pass. |
| Gemini 3.8 Flash, minimal | 71.7% (one run) | 29.5 s | $0.19 | As many reasoning tokens as low. Google returned 429 for 10 calls. |
| Qwen 3.8 Flash | 63.5%, 63.4% | 17.5 s, 19.2 s | $0.008, $0.008 | Cheapest usable score, but slow to first findings. 20 calls rate-limited in one run. |
| Qwen 3.7 Flash, with cache_control | 32.6%, 44.3% | 65.8 s, 28.9 s | $0.006, $0.006 | 89 and 17 failed calls, mostly 429. |
| Mercury 2.5 | 56.0%, 48.3% | 5.3 s, 5.0 s | $0.005, $0.005 | As fast as DeepSeek at a third of the cost, 10 to 17 points lower. |
| MiMo V2.6 Flash, thinking off | 28.6%, 32.7% | 21.0 s, 47.4 s | $0.015, $0.016 | Returns an object, not an array. The parser rejects about half its replies. |

### For paragraph order

DeepSeek Flash at high, the shipped setting, scores 83% and 86%, takes 30 to
40 seconds and costs $0.005 a draft.

| Model | PO F1 | Per draft | Cost per draft | Why it is not the default |
|---|---|---|---|---|
| Gemini 3.8 Flash, medium | 85.7%, 83.3% | 52.1 s, 51.2 s | $0.053, $0.057 | 3 to 6 points above low, at about 15 times the time and 20 times the cost. |
| MiMo V2.6 Pro, on | 71.4%, 83.3% | 184.8 s, 88.4 s | $0.009, $0.005 | Slow. |
| MiMo V2.6 Flash, on | 76.9%, 71.4% | 189.7 s, 142.7 s | $0.002, $0.002 | Slow. One call failed after 270 seconds. |
| GLM 5.3 Flash, high | 58.8%, 66.7% | 125.6 s, 81.6 s | $0.002, $0.001 | Low precision, slow. |
| GPT-6 Luna, medium | 61.5%, 46.2% | 35.9 s, 33.1 s | $0.002, $0.002 | Low F1 in both runs. |
| GPT-6 Luna, high | 46.2%, 66.7% | 42.8 s, 37.0 s | $0.002, $0.002 | No better than medium. |

### Thinking on for every pass

| Configuration | Run F1 | Per draft | Cost per draft | Why it is not the default |
|---|---|---|---|---|
| DeepSeek Flash, high (`B-flash-high` to `-4`) | 67.0% to 70.8% | 146 to 171 s | $0.12 to $0.13 | The first setup. Same quality as the fast passes, about 25 times slower. |
| DeepSeek Pro, high (`A-pro-high-300`) | 72.7% | 586 s | $0.17 | Ten minutes a draft. |
| DeepSeek Pro, off, no verifier (`D-pro-off`) | 42.3% | 22.6 s | $0.018 | Slower and no better than Flash off. |

`reasoning_effort = "low"` does not help DeepSeek Flash. It spent 11,000 to
16,000 reasoning tokens on one paragraph, as many as `high`.

## Jev

Jev is TypeSafe's decision model. It answers three kinds of question with
probabilities: yes or no, one of up to 255 labelled options, and a place on a
scale. It cannot write text, so it cannot write a note or a quote. Code has
to supply both.

The list-free methods split the draft into sentences with `Intl.Segmenter`,
which needs no language setting. The pass's own rule text is the question.

- **Method 1.** One yes/no question per sentence. The quote is the whole
  sentence.
- **Method 2.** Method 1, then, for each sentence it keeps, code lists every
  span of one to eight words, and a multiple-choice question picks the span
  the rule says to quote. Up to three more rounds look for another problem in
  the same sentence.
- **Method `across`.** Method 2, plus one yes/no question per paragraph: does
  the problem lie across two or more sentences? If yes, one multiple-choice
  question picks the sentence that holds the quote, and one picks the span.
  Here the spans also include every span that starts at the sentence's first
  word, at any length. SPEC §8.4 defines it for sentence openings.

Per pass, on the four drafts, two runs each:

| Pass | Jev | Jev F1 | DeepSeek direct F1 | Jev cost per draft |
|---|---|---|---|---|
| filler-words | Method 1 | 75.7%, 77.8% | 74.3%, 68.4% | about $0.001 |
| filler-words | Method 2 | 83.7%, 85.7% | 74.3%, 68.4% | $0.0022 |
| passive-actor | Method 1 | 66.7%, 73.7% | 60.0%, 57.1% | $0.0011 |
| passive-actor | Method 2 | 73.7%, 70.0% | 60.0%, 57.1% | $0.0015 |
| sentence-openings | `across` | 66.7%, 61.5% | 66.7%, 66.7% | $0.0018 |
| sentence-openings | `across`, clearer rule | 72.7%, 72.7% | 90.9%, 66.7% (clearer rule) | $0.0018 |
| sentence-openings | old script, not rule text only | 72.7%, 72.7% | 44%, 60% | $0.0017 |
| sentence-openings | old script, clearer rule, not rule text only | 100%, 88.9% | 44%, 60% | $0.0018 |
| nominalization | Method 1 | 73% (mean) | 92% (earlier hybrid runs, mean) | about $0.001 |

Sources: `2026-09-23-jev-nolist.md`, `2026-09-23-followup.md` and
`2026-09-23-jev-across.md`. The DeepSeek column for the `across` rows ran
sentence openings alone (`ds-so-rw`, `ds-so-jo`). The other DeepSeek numbers
come from full runs.

The two "old script" rows do not measure a rule-text-only method. The script
`run-sentence-openings.ts` puts rule logic in code: questions that name the
two problems, counting of runs by pairs, and a count of words before the
subject. Method `across` (`run-across.ts`) replaces it.

- Method 2 quotes exactly the reference words for all 18 filler-word hits.
  Method 1 always quotes the whole sentence, which the scorer accepts but a
  writer would not want.
- For missing actor, Method 2 is exact on 3 of 7 hits. The others quote the
  verb group without its short subject. The rule asks for the subject when
  it is short.
- The clearer sentence-openings rule says that sentences sharing only a
  first pronoun or article are not a run, with an example. With the old
  wording, Jev and DeepSeek both flagged runs such as "I left… I reached… I
  arrived" and "She rang… She carried… She went". With the new wording
  neither flagged one, in two runs each. DeepSeek's mean on the pass rose
  from 66.7% to 78.8%.
- Method `across` found the run "The board" and three of the four late
  subjects in every run, and quoted the reference words each time. It never
  found the late subject "By the time I reached the top of the hill that
  February,". It flagged "It is… It is" twice in `on-writing.md`, where the
  rule asks for three sentences. One `across` run scored 66.7% only because
  the scorer placed its quote "I" inside a reference item by accident. The
  finding pointed at another sentence. Without that hit it scores 50%.
- Filler words with Method 2 on the 5,000-word chapter: 115 requests, 7.4
  seconds, $0.013, no error. The largest request used 8,661 tokens, 14% of
  Jev's limit of 64,000.
- Spanish: a hand translation of the essay, with the English rule files
  unchanged. Method 1 on three passes scored 67%, against 74% on the English
  original. Filler words held up best.
- Jev's answers vary between runs. A word near the keep threshold can flip
  from one run to the next. Every keep threshold here is 0.45 or 0.5. The
  thresholds are a compromise and were not tuned.

Recommendation. Use Jev for filler words with Method 2. Its mean is 13
points above DeepSeek's, and it runs a chapter in 7.4 seconds for about a cent.
Keep sentence openings on DeepSeek. Method `across` scored 72.7% twice with
the clearer rule, against a DeepSeek mean of 78.8% with the same rule. Keep
nominalization and missing actor on the LLM too. The starter rule for
sentence openings now has the clearer wording. It removed the pronoun-only
runs on both models and did not lower DeepSeek's score.

The app runs Method 2 as method `sentence` (SPEC §8.4). Method `across` is
not built. "Filler words on Jev", above, shows the setup.

The first Jev attempt found candidates with hand-written word lists. It broke
the rule that a pass's rule text is its whole definition, so its code is
deleted. `bench/results/2026-09-23-jev.md` records what it measured.

## Running the benchmark yourself

Put `DEEPSEEK_API_KEY` or `OPENROUTER_API_KEY` in the repo's `.env`. Then:

```
bun bench/scripts/run.ts --provider deepseek --model deepseek-flash \
  --thinking off --rules 2026-09-23-rewrite --pipeline hybrid --label flash-hybrid
bun bench/scripts/table.ts
```

`--dry` prints the plan without calling a model. `--provider openrouter`
takes a model as OpenRouter names it, and pins it to its vendor.
`--provider agy` runs agy through the app's own runner. `--serial 60` runs
the drafts one at a time, for a provider with a per-minute limit. Run each
configuration at least twice.

[`bench/RESULTS.md`](./bench/RESULTS.md) lists every result.
[`bench/results/`](./bench/results/) holds the result files and the write-ups.
[`bench/README.md`](./bench/README.md) explains the corpus, the scorer and
every option.
