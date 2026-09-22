# Devlog

Assumptions made while building, and decisions taken without asking. Each entry
names the commit that introduced it. Read this if something surprises you.

## Format

Entries are newest first. `ASSUMPTION` needs checking. `DECISION` is settled
unless you disagree. `DEFERRED` is a known gap.

---

## 2026-09-21 — first build

**ASSUMPTION — "rules must be configurable" means the two writing rules.**
`0a98531`, spec change in `af5d5c4`. I read this as Ptacek's two rules (no
model wording, no encouragement), which SPEC 2 had previously declared
non-negotiable. They now live in `[rules]` in `config.toml` with strict
defaults. The editing prompts were already files, so that reading would have
been a no-op. If you meant something else — keyboard bindings, say — tell me.

**ASSUMPTION — `allow_suggestions = true` is accepted but does nothing yet.**
`0a98531`. The config key parses and the preamble drops its no-suggestions
clause, but the finding schema still has no `replacement` field and there is
still no apply action. Turning it on today only makes the model more likely to
write wording into a note, which the redaction guard then hides. Finishing it
means a second schema and an apply command. Say if you want that.

**DECISION — single letters only work in review mode.** `0a98531`. SPEC 12.4
gives `n`, `p`, `j`, `k`, `x`, `d` and `r` as bare keys, but in a writing app a
bare `n` has to type an "n". `Esc` leaves the text and enters review mode,
where the bare keys work and the editor dims; `Esc`, `Enter` or `i` returns.
`⌥↓` and `⌥↑` step through findings without leaving the text.

**DECISION — autosave writes the Markdown file every 1.2 seconds.** `0a98531`.
Consecutive minor saves collapse into one revision row, so this does not bury
revisions you flagged. The file on disk is therefore almost always current,
which is the point of Markdown being the source of truth.

**DECISION — only Anthropic has a default model id.** Other providers must name
a `model` in `config.toml`. Guessing OpenAI's or Google's current model id
would fail later with a worse message than the one you get now.

**DECISION — `keyring` 4 with default features.** Its `apple-native` feature
was renamed; the `v1` default already pulls in the macOS keychain backend.

**DEFERRED — the duel is not built.** SPEC 11. Everything under it exists —
the `duels` table, `blind_judge`, `judge_provider` — but there is no UI and no
judge call yet.

**DEFERRED — revision history has no viewer.** Revisions are recorded and can
be flagged major from the palette, but nothing lists or diffs them.

**NOTE — the app icon is a serif "w" over a rule.** Placeholder aesthetics.
Replace `src-tauri/icons/` whenever you like; regenerate with
`bun x tauri icon <source>.png`.

## 2026-09-22 — first real provider run

**DECISION — every backend parses text; nothing uses `Output.array`.** The AI
SDK's per-element streaming looked right and broke on the first provider we
tried. DeepSeek has no structured-output support, so the SDK asked for
`response_format: json_object`, the model returned a bare JSON array, the SDK
expected its own wrapper, and the run reported zero findings with no error.
`parse.ts` now reads the text itself, for the API backend and the CLI backend
alike. Findings arrive per pass rather than per finding, which SPEC 15 had
flagged as an open question anyway.

**DECISION — every pass prompt contains the word "json".** DeepSeek returns
HTTP 400 for a `json_object` request whose prompt lacks it. `outputNote()` says
it, and `parse.test.ts` asserts it so it cannot be edited away.

**ASSUMPTION — `deepseek-flash` is "DS 4.1 Flash".** The DeepSeek models
endpoint lists exactly two ids, `deepseek-flash` and `deepseek-v4-pro`. I took
the first. It answered a full pass in about 65 seconds for a 105-word draft,
which is slow enough to matter once nine passes run over a real piece. Worth
comparing against `deepseek-v4-pro` and against a faster vendor.

**DECISION — keys can come from a `.env` file.** A desktop app launched from
Finder inherits almost nothing, so `env:NAME` alone is not a reliable way to
hand the app a key. `resolve_key` now falls back to a `.env` in
`$WRITEGOOD_HOME`, then the working directory and up to four parents.
`.env` is in `.gitignore`.

**NOTE — `dev/probe.ts` runs one pass against a real provider without the app.**
`bun dev/probe.ts <pass-slug> [provider]`, `--raw` to see the unparsed reply.
It uses the app's own preamble, prompt builder and parser, so it tests the code
that ships. It found both bugs above.

**VERIFIED — the whole in-app loop works.** `1c88a88` onward, checked at
`2026-09-22`. One paragraph-scope pass run from inside the app against
DeepSeek: key resolved from `.env`, three paragraph calls went out through
Tauri's HTTP plugin, the replies parsed, and three findings landed in SQLite
with the run marked done. The probe alone could not have shown this, because it
uses the platform's own fetch rather than the plugin's.

**NOTE — `VITE_WRITEGOOD_AUTORUN` is a development hook in `App.svelte`.** It
runs a pass on boot. It exists because driving the window from a script needs
accessibility permission a terminal does not have, and `screencapture` fails
for the same reason, so there is no other way to exercise the in-app path
unattended. Harmless when unset. Remove it if it offends.

**DECISION — `tauri-plugin-http` pinned to `~2.6` to match the npm package.**
The Rust crate had moved to 2.7.0 while `@tauri-apps/plugin-http` has no 2.7.x
release, and Tauri warns on every launch about the mismatch.

## 2026-09-22 — the duel and the history

**VERIFIED — the duel does not leak which version is newer.** `bb09350`.
Fourteen duels against DeepSeek across two runs, with the sides shuffled each
time. The rewrite won every one, from the A position and the B position alike,
so the verdict is tracking the prose rather than the position. The passages
were a deliberately nominalised paragraph and a plainer version of it, so the
right answer was known in advance.

**DECISION — `parseVerdict` has a salvage path.** One reply in ten failed to
parse. The judge quotes words from the passages it is judging — "decided to
decide" — and does not always escape the inner quotes. Strict `JSON.parse`
runs first and is unchanged; only on failure does a tolerant matcher pull
`verdict` and `reason` out, and the schema judges both the same way. Eight
duels since with no failures.

**DECISION — `churn` ignores whitespace.** `similar` tokenises the gaps between
words, and those tokens match even when every word around them has been
replaced. A complete rewrite scored 0.95 instead of 1. Documented with a test
so the next reader does not think it is a bug.

**ASSUMPTION — restoring a revision saves a new major revision.** Nothing is
lost, because the current text was already saved before the restore. It does
mean the history grows on every restore. Say if you would rather it rewound.

**DEFERRED — the judge is asked once.** Three calls with the sides reshuffled
would be a better signal for three times the cost. One verdict currently
decides a duel.

## 2026-09-22 — looking at it

**NOTE — `bun run browser` renders the app with Tauri mocked out.** Fixtures in
`dev/browser/`, served at :1421, `?theme=dark` and
`?show=review|history|duel|palette`. Headless Chrome screenshots it. This is
the only way to see the design, since both screen recording and accessibility
permissions are unavailable to a terminal.

It immediately found four things that every test suite had passed over:
paragraph spacing cancelled by a later `p { margin: 0 }`, margin notes stacked
with a hardcoded height so they overlapped, a command bar that sliced its last
row in half, and revision timestamps rendered as UTC because SQLite's
`datetime('now')` carries no marker.

**DECISION — the margin reads in document order.** It was sorting by severity,
which put a late high-severity finding at the top and then dragged every note
below it out of line with its text.

**DECISION — Literata, one accent.** The accent is a muted vermilion and means
"you are here": the selected finding, the selected palette row, additions in a
diff, the duel's verdict, and the two states worth a glance — *working* and
*unsaved*. Severity still reads as the weight of an underline. Checked in both
themes.

## 2026-09-22 — what the parser was quietly doing

**FIXED — a decoy array could empty a pass with no error.** `extractArray`
took the first `[` anywhere in the reply, so `{"meta": {"tags": ["draft"]},
"findings": [...]}` returned `["draft"]`, every item failed the schema, and the
pass reported no findings and no error. This is the second time the same shape
of bug has appeared: a provider returns good output and the run says nothing
was found. The parser now walks candidate bodies — every ```json fence, then
every plain fence, then the raw reply — and takes the first balanced array that
is empty or whose first element is an object, falling back to any array rather
than throwing.

**FIXED — a fenced quotation hid the findings.** The fence pattern matched the
first fence of any kind, so a reply that quoted the draft in a plain fence
before the array lost the array entirely. Fences are now searched in order of
usefulness.

**DECISION — the quote lower bound stays at two characters.** The validator and
its own description disagreed, and I first corrected the wrong one. A short
quote anchors perfectly well, because it is placed with thirty-two characters
of context either side, and a filler-words pass has every right to quote "so".
Only the upper bound means anything.

**NOTE — a dead branch was kept on purpose.** `parseFindings` guards against a
non-array, which `extractArray` can no longer produce. Two lines of guard are
worth keeping against a future change to the extractor.

**FIXED — a truncated reply is loud again.** Collecting every balanced array
meant `[{"a": [1]}` returned the inner `[1]` rather than null, turning a throw
into a quietly empty pass. The fallback span must now start at the candidate's
first `[`. A throw names the provider and gets noticed; an empty pass looks
like a clean nothing-found and does not.

**DECISION — a real array beats an earlier empty one.** `nothing in this
paragraph: []` followed by the actual findings is a plausible reply, and the
first rule read it backwards. The order is now: the first non-empty array of
objects, else any array of objects, else the first balanced array of the first
candidate that has one. A lone `[]` still means no findings.

**FIXED — the last quiet path, and three misleading messages.** A reply that
could not be read used to say one thing whatever had happened. It now says
which of four, because each implies a different fix: items that fail the
schema, a reply cut off mid-array, an array holding no findings, or no array at
all. A well-formed array whose every item fails the schema now throws with the
count and the first Zod issue, rather than returning nothing silently — a
provider that renames a field must not read as a clean nothing-found. Dropping
individual malformed items is unchanged, and an empty array is still silent.

**DECISION — no fallback to an array of non-objects.** It existed to avoid
throwing, and throwing is the point: it named the provider and got noticed,
where an empty pass looked like success. Nothing valid was lost, since a real
findings array always starts with `{`.

**NOTE — a stray unclosed `[` in prose reads as truncation.** `I looked at
paragraph [3` reports "probably cut off". Weighing where the bracket sits is
more machinery than the case deserves, which is why the wording hedges.

## 2026-09-22 — the app builds, and a real limit found

**FIXED — the app did not build for release.** `tauri build` failed on
`zerofrom`, then `phf`, then `serde`: every proc-macro dependent, each unable
to find its own derive crate. Proc macros and build scripts run on the host at
compile time and inherit the release profile, and `strip` and `opt-level` leave
them in a form rustc cannot load. `[profile.release.build-override]` builds
them plainly while the app keeps `lto`, `opt-level = "s"` and `strip`. This had
been broken since the first commit and would only have shown up the day you
tried to ship.

**FIXED — `bun run app:build` exited non-zero.** The DMG step needs `hdiutil`,
which fails outside an interactive session. Bundle targets are now `["app"]`
only. Re-add `"dmg"` when you want something to hand to other people.

**REMOVED — `macOSPrivateApi`.** Switched on for a transparency effect the app
does not use.

**ADDED — a log file.** `~/.writegood/writegood.log`, trimmed at half a
megabyte. The pass runner records every call, its size, its ceiling and its
answer; boot records what it loaded; uncaught errors and unhandled rejections
land there too. A built app has no visible console, so without this a pass that
dies takes its explanation with it. Adding it should have been the first move
rather than the last: it answered in one run what four rounds of inference
about `lsof` output and CPU readings had got wrong.

**OPEN — a pass stops when the window is not visible.** The evidence, from the
built app: call one answers in two seconds, call two is logged as starting and
nothing follows. No TCP connection, no CPU, and the `setTimeout` that enforces
the per-call ceiling never fires either. A timer that does not run is the
signature of a suspended WebKit process, which is what macOS does to an
occluded window under App Nap. It reproduces in `tauri dev` and in the built
bundle alike, and only while the window is not in front.

That makes it an artifact of running the app unattended — a real user has the
window open — but it is still a genuine limit: start nine passes, switch to
your browser, and the run may freeze. The honest fix is to move provider calls
out of the webview into Rust, where nothing suspends them. That is a real
architectural change and wants your agreement first, so it is not done.

**NOTE — a launched app finds no `.env` in a repository.** Double-clicked or
opened with `open`, the app inherits no environment and starts in `/`, so the
key must live in `~/.writegood/.env` or the keychain. Launched from the project
directory it finds the repository's `.env` and works, which is what masked
this. The error now says exactly what to do.

## 2026-09-22 — provider calls moved into Rust

**DONE — `genai` replaces the Vercel AI SDK.** Every network call now runs in
`llm.rs` as a tokio task. The freeze is gone: four calls, window unfocused,
sixty-two seconds, four findings. That is the exact condition that used to stop
a pass after the first call with no error and no timeout.

`genai` is the closest Rust equivalent of the AI SDK's core — one call shape
across Anthropic, OpenAI, Gemini, DeepSeek, Ollama and OpenRouter, with a
`ServiceTargetResolver` for the rest. `rig-core` is more popular but is an
agent framework, far heavier than "send two strings, get text".

I should have surfaced this in the original stack proposal. I weighted "best
provider abstraction" heavily, chose the AI SDK on that basis, and never
checked whether the runner-up was good enough. It was, and choosing it would
have avoided the freeze entirely.

Out: `ai`, three `@ai-sdk/*` packages, `@tauri-apps/plugin-http` and its
capability entry. Keys no longer reach the webview at all.

**DECISION — the probe drives the Rust client.** `dev/probe.ts` builds the
prompt with the app's preamble and prompt builder, hands it to
`cargo run --example probe`, and parses the reply with the app's parser. Every
part of the path ships. Same for `dev/probe-duel.ts`.

**FIXED — a second binary made Tauri bundle the wrong one.** The probe started
life in `src-tauri/src/bin/`, and the `.app` then contained `probe` rather than
`writegood`. It did not crash; it simply was not there, and an empty log was
the only symptom. It lives in `examples/` now.
