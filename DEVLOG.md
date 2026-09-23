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

**NOTE — the app icon is a serif "wg" over a rule, in the dark palette.**
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

*Superseded on 2026-09-22: the HTTP plugin is gone, with the AI SDK that needed
it. See "provider calls moved into Rust" below.*

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

## 2026-09-22 — the macOS menu, and a folder that would not open

**DONE — a real macOS menu, in `menu.rs`.** writegood, File, Edit, Review,
Window. Every custom item carries the accelerator the keyboard already used and
emits the id of a palette command; the palette runs it. One code path, so the
menu and the keyboard cannot drift. The Edit submenu matters most: WKWebView
takes Undo, Cut, Copy, Paste and Select All from the menu, and the default
Tauri menu was the only reason they worked at all.

The menu is `#[cfg(target_os = "macos")]`. On Windows and Linux Tauri draws the
menu inside the window frame, above the document, which is the in-app chrome
SPEC §12.1 rules out. Those platforms get the keyboard and `⌘K`.

It is built through `Builder::menu`, not `AppHandle::set_menu` in `setup`. A
menu set in `setup` does not take: the window already exists with the default
menu and keeps it. The symptom is a menu bar that still reads File, Edit, View,
Window, Help.

**FIXED — "open the writegood folder" did nothing.** The palette called the
opener plugin from the webview, and the capability file granted
`opener:default`, which covers `open-url` and `reveal-item-in-dir` but not
`open-path`. The rejection never reached the screen. The log had it:
`Command plugin:opener|open_path not allowed by ACL`. There is a
`shell_open_path` command in Rust now, which is where the filesystem belongs,
and the menu item calls `tauri_plugin_opener::open_path` directly.

**FIXED — `cargo run` could not choose a binary.** `default-run = "writegood"`
in `Cargo.toml`. The probe had already moved to `examples/`, which removed the
ambiguity; the manifest key makes it stay removed.

**Two behaviours changed with the accelerators.** `⌘⇧S` now asks what changed
instead of saving a revision labelled "major revision", and `⌘⇧⏎` now asks
which pass to run, which is what the palette had always advertised. Both go
through the palette command the menu item names.

## 2026-09-22 — usage costs per file

**DONE — the status bar can show what the open file has cost.** Off by default;
`show_cost = true` under `[appearance]` turns it on. SPEC §9.4 has the design.

**DECISION — prices come from models.dev.** One public file, no key, rates per
million tokens for input, output, cache read and cache write. llmcatalog.dev
serves price history one model at a time and has no bulk catalog, so it cannot
answer a lookup. We keep a slim copy, 517 KB against the source's 4.8 MB, at
`~/.writegood/prices.json`, refreshed in the background when a week old.

**DECISION — the vendor is the provider's table name.** `kind` cannot be used:
`openai-compatible` is a protocol, not a vendor. Both configured providers,
`deepseek` and `anthropic`, match the catalog as they are. `catalog = "..."`
covers a provider whose name differs.

**ASSUMPTION — a part-priced run counts as unpriced.** If any call in a run has
tokens but no price, the run records tokens and a null cost, and the status bar
counts it under "tokens unpriced". The dollar figure is then short by nothing
it claims to include. Needs checking: whether you would rather see the priced
part in dollars.

**ASSUMPTION — tiered pricing is ignored.** Google charges more past 200k
tokens of context. The base tier is used. No pass comes near the boundary.

**GAP — a duel whose verdict will not parse records no cost.** The duel row is
written only after the verdict parses, so a failed judge call is paid for and
not recorded. Pass runs do not have this gap: usage is kept before parsing, and
a failed run still records what it spent.

**VERIFIED against DeepSeek.** The probe fetched the catalog on first use and
priced one call at $0.010516; the arithmetic checks by hand. In the app, a pass
that failed on its second call still recorded 980 in, 2,353 out, $0.001484.
The migration added the six columns to the existing database, and older runs
read null, not zero.

**NOTE — reasoning dominates the cost on deepseek-flash.** One probe call used
445 input tokens and 17,478 output tokens, almost all of it reasoning. Output
is over 99% of that call's cost.

## 2026-09-23 — driving the real app

**DONE — end-to-end tests and a driver for dev builds.** SPEC §16 has the
design. `bun run e2e` builds a debug binary into `src-tauri/target/e2e` and
runs eight tests in about 12 seconds, build included. `bun dev/drive.ts` drives
a running `bun run app`.

**DECISION — plain `webdriverio` from Bun, not the WDIO runner.** The trial
with `@wdio/tauri-service` passed but needed Node, a second plugin, a frontend
import and `withGlobalTauri`, and spent 60 of its 70 seconds in 5-second
window-focus waits. `remote()` against the embedded plugin needs none of it.
The same checks ran in 1.7 seconds.

**DECISION — the fake model speaks the OpenAI protocol.** A CLI fake would skip
the Rust HTTP client and report no usage. The HTTP fake goes through `genai`,
the token count and the price lookup, so the cost label is checked with real
arithmetic: 76 calls at $0.0014 showed as $0.106.

**BLOCKED — the duel test.** The plugin sets modifier flags on letters and
digits only. `⌘⏎` arrives as a bare Enter, and the duel submits only on `⌘⏎`.
The bug is in 1.4.0 and on the plugin's main branch, with no issue filed.
Passes are run from the `⌘K` palette instead, which does work.

**NOTE — the plugin needs no capability permission.** It is an HTTP server, not
a command surface. `wdio-webdriver:default` grants nothing and was left out.

**NOTE — a synthetic click does not move the caret.** `addValue` then types at
the start of the document. The tests set the DOM selection first.

**NOTE — webdriverio adds 214 packages and 67 MB to `node_modules`.** It is a
dev dependency.

**UNVERIFIED — the release binary.** The plugin is registered under
`#[cfg(debug_assertions)]`, so a release build does not start the server. The
crate is still compiled in, and no release build has been inspected.


## 2026-09-23 — ⌘R beside ⌘⏎

**DONE — `⌘R` runs the passes and asks the judge, and `⌘⏎` still does.**
`⌘⇧R` and `⌘⇧⏎` run one pass. The Review menu shows the R keys, because a menu
item holds one shortcut; the window's key handler takes the Enter keys. The
reason is the WebDriver plugin, which drops ⌘ from Enter. With `⌘R` the duel
has its end-to-end test, and the suite is ten tests in about 4 seconds.

**ASSUMPTION — either the page or the menu may see a ⌘ key first.** Nothing in
this session could send a real keystroke, so the order on macOS is unknown. The
app now works in both: while the duel is open the menu's `Run all passes`
asks the judge, and the palette ignores menu commands behind a sheet. Needs
checking by hand: `⌘R` and `⌘⏎` in the duel ask the judge and run no passes,
and `⌘⇧⏎` opens the pass list.

**CHANGE — `⌘⇧⏎` in the window now opens the pass list.** The key handler used
to run every pass on `⌘⏎` with or without ⇧. That did not matter while the
menu held `⌘⇧⏎`. It does now that the menu holds `⌘⇧R`.

## 2026-09-23 — clicks, overlaps and tidy edges

**DONE — a click on a highlight lights every finding under it**, in the text
and in the margin, and focuses the first in document order. The next `j` or
`k` lights one again. SPEC §12.3.

**DONE — a click in the text sets the margin level with the words.** The
focused note's top moves level with the clicked highlight, and the draft stays
where it is. `j` / `k` and clicks on a note still only bring it into view. The
margin's track now runs a band's height past the last note, so a note low in
the stack can rise that far. The wheel still stops at the last note.

**DONE — drawn ranges are tidied** in `spans.ts`: no leading or trailing
space, no leading comma, and overlapping ends that differ only by closing
punctuation meet at the later one. The stored quote is unchanged.

**FOUND — ProseMirror keeps one `data-finding` where findings overlap.** It
joins the classes of overlapping decorations but keeps one value of any other
attribute. A highlight fully inside another had no element of its own with its
id. Each decoration now also carries `finding-id-N`, and `finding-lit-N` when
lit, and the margin aligns by editor position rather than by that element.

**FOUND — an element click in the WebDriver plugin sends only `click`, at
0,0.** ProseMirror ignores it. Tests click with pointer actions instead.
||||||| aced302

## 2026-09-23 — text size, and the palette keeps its row in view

**DONE — `⌘+` and `⌘-` change the text size.** 1px a step, 12px to 32px,
saved to `[appearance] font_size`. A new View menu carries both. The margin and
the chrome already used `em` and `rem`, so they scale with the body; no
stylesheet changed. An end-to-end test checks both sizes and the saved value.

**DONE — the palette scrolls its selected row into view.** Arrow keys past the
bottom of the list used to leave the selection out of sight. The row now stops
above the list's bottom fade. An end-to-end test failed without the fix and
passes with it.

**NOTE — a size change rewrites `config.toml`.** The save serialises the whole
config, so hand-written comments in the file are lost. Changing the theme from
the palette already did the same.

**UNVERIFIED — the View menu by hand.** The tests cannot reach the menu bar.
Needs checking: View shows `⌘+` and `⌘-`, and both keys work from the menu.

## 2026-09-23 — three loose ends

**FIXED — a save no longer wipes the comments in `config.toml`.** The app used
to write the whole file from its own settings. It now edits the file with
`toml_edit`: a value it changed is replaced in place, with the comment beside
it; everything else stays, including keys the app does not know. A key the app
has no value for is left as it is, not removed.

**FIXED — `⌘+` and `⌘-` work while the duel or the revisions sheet is open**,
from the keyboard and from the View menu. Every other menu command still waits
until the sheet closes.

**FIXED — `bun dev/drive.ts click` clicks the way a hand does.** It sends
pointer actions at the element's middle, so ProseMirror sees the mousedown and
moves the caret. The plugin's own element click is unchanged. It is a
third-party defect and has not been reported upstream.

**NOTE — the palette e2e test failed once in a full run** and passed in six
runs after. The cause was not found.

**DECISION — Noto Serif and two four-colour palettes.** This replaces
Literata and the single vermilion accent. Noto Serif is bundled as a variable
font with weight and width axes. The body is 16px, width 100, weight 250. H1 is
36px, width 95, weight 300, and each level below steps towards the body. Each
theme ranks its four colours: primary, secondary, tertiary and paper. Light
uses `#425B9A`, `#76C0EC`, `#FF95A5` on `#FFF6DC`. Dark keeps its neutral
paper and greys and takes only accents from its palette: `#FF467A` for
headings, `#5003C0` for the selection and the selected finding, `#AB03A9` for
underlines, `#FFD51E` for the note bar, the note's category and the caret. A
first version drew the dark paper from `#5003C0` too; it was reverted. SPEC
§12.1 lists every role. Checked in both themes in the browser view.

**CHANGED — margin notes are 0.8em of the body, up from 0.7em**: 12.8px at
the 16px base.

**DONE — `⌘0` resets the text size to 16px**, from the keyboard, the View menu
and the palette, and over either sheet. **DONE — "switch light and dark"** in
the palette and the View menu, beside the existing three-way theme command.

**NOTE — a config written before this change keeps Literata.** The old default
config wrote `font = "Literata, …"`. Literata is no longer bundled, so such a
file falls back to `ui-serif` until the line is removed or changed.

**UNVERIFIED — the new View items by hand.** The tests cannot reach the menu
bar. Needs checking: View shows Actual size with `⌘0`, and both theme items
work.

## 2026-09-23 — fast passes (fcf6ec4)

**DECISION — thinking off, with a verifier, for eight of the nine passes.**
Measured on four drafts against 82 reference findings written by Opus, with
an Opus judge for the findings the reference missed. Thinking on for every
pass scored F1 67–71% and took two to three minutes a draft. Thinking off
alone scored 43%: it finds nearly everything and flags twice as much that is
wrong. Code filters and a three-vote verifier bring it to 64–65%. Paragraph
order with thinking on brings the whole run to 71–72%, with first findings in
about six seconds. SPEC §8.3 has the design.

**DECISION — the starter passes are rewritten.** Each states a test, what not
to flag, the span to quote, the severity scale and what a note may say. They
live in `src-tauri/passes/`. Topic flow runs at paragraph scope.

**NOTE — `reasoning_effort = "low"` does not help DeepSeek Flash.** It spent
11,000 to 16,000 reasoning tokens on one paragraph, as many as `high`. Only
`thinking: {"type": "disabled"}` is fast.

**ASSUMPTION — the reference findings are right often enough to rank
configurations.** Repeat runs of one configuration differed by up to five F1
points. The document passes have five or six reference items each.

## 2026-09-23 — windows and saved answers

**DECISION — long drafts are sent in windows.** A draft over 16,000
characters is split into cores of 4,000 to 12,000 characters, each with three
paragraphs of context either side. Boundaries fall after a paragraph whose
FNV-1a hash is divisible by four, so an edit moves only nearby boundaries and
the other windows stay in the provider's prompt cache.

**DECISION — every answer is saved and not asked again.** The key covers the
pass's settings, the paragraph and the paragraph before it. The rest of the
window is context and is not in the key, so a finding that depends on distant
text can go stale; *run all passes afresh* asks everything again. Findings on
unchanged paragraphs keep their status, so a dismissed finding stays
dismissed.

**MEASURED — a 5,000-word chapter in the real app.** 112 paragraphs, about
790 calls. First run: the fast passes in about 25 seconds, paragraph order in
110 to 145 seconds, ten to seventeen cents. After editing one paragraph: the fast
passes in about three seconds, paragraph order again in about two minutes.
With no edit: 1.5 seconds and no calls.

**FIXED — one unreadable reply no longer fails a pass.** With thinking off, 11
of about 790 replies were prose or a refusal. Each now fails only its own
call, which the next run asks again.

**CHANGED — paragraph order's ceiling is 300 seconds.** It took 145 seconds on
the chapter, against the old 150.

**DEFERRED — paragraph order reruns on every edit.** Its key is the whole
draft, so any edit sends it again, and it is the slowest call.

**UNVERIFIED — windowed quality.** Every measured draft fits one window, so
the reference scores say nothing about windows. Measuring needs a long draft
with reference findings.


## 2026-09-23 — markers for unchecked paragraphs

**DECISION — review mode marks the paragraphs that are not checked.** A
paragraph is not checked when an enabled paragraph-scope pass has no saved
answer for its current key. After a run most paragraphs are checked, so the
app marks the exception. The marker is a grey dot in the left gutter,
level with the first line. It shows only in review mode.

**DECISION — the runner and the markers share one key function.**
`passKeys` in `run.ts` computes a pass's fingerprint and keys. The markers
call it with the session's provider override, as the runner does, so the two
cannot disagree about which paragraphs have answers.

**ASSUMPTION — a pass whose provider does not resolve has no answers.** The
markers leave such a pass out. With no paragraph-scope pass enabled, there
are no markers and no status message.

**CHANGED — the browser fixtures return saved-answer keys.** `mock-core.ts`
computes the app's own keys for the open draft and leaves out two
paragraphs, so `?show=review` shows two markers.

## 2026-09-23 — agy as a cli provider

**DECISION — every cli call runs in a new, empty directory.** This covers
`claude-cli` too. agy is an agent: without guards it ran shell commands and
wrote files. Its config writes a custom agent with no tools and a hook that
denies every tool into that directory. SPEC §9.3 has the TOML, and
`config.toml`'s template carries it commented out.

**DECISION — a cli pass that does not think gets the verifier.** agy with
the verifier scored F1 77–79% on the four drafts, and 68–69% without it.
`verifies()` now looks only at the thinking level, not the provider kind.
This changes the answer keys of cli passes, so their saved answers are asked
again once.

**DECISION — `thinking_names` renames a level for a cli command.** agy has no
`-off` or `-max` model. Its config maps `off` to `low` and `max` to `high`,
so a pass with thinking `off` runs on `-low` and still counts as not
thinking.

**DECISION — each provider has its own call limit.** `max_in_flight` bounds
one provider's calls, and the run still never has more than 32 in flight. A
call waits for its provider's slot before it takes a run slot, so agy's 8 do
not slow DeepSeek passes in the same run.

**UNVERIFIED — the duel judge through agy.** Not tested.
