# writegood — specification

Status: built, 23 September 2026. The build order in §14 is done; §15 lists
what is open. Passes on Jev (§8.4, §9.5) are built with method `sentence`.
Method `across` is specified and not built.

---

## 1. What it is

A local desktop app for workshopping your own prose. You write a draft in it.
You run editing passes over the draft. Each pass is a prompt you wrote
yourself. The app shows you what the model found, anchored to the text it found
it in. You do the rewriting.

The shape comes from Thomas Ptacek's *How To Write With An LLM*
(sockpuppet.org, 17 September 2026) and the opening prompt he used to build his
own version:

> We're going to build a writing workshopping tool. First get the bones up.
> Python, HTMX for interactions, SQLite backend, Tailwind frontend, use a local
> build not the CDN. Really excellent prose editor, Notion-style. Support
> highlighting (we're going to do editing passes). Do Genius-style sidebar
> commentary to match highlighted things. Make sure we can tick forward and
> back through suggestions. Multiple documents, track revisions, allow user to
> flag major revisions.

This spec keeps his feature list and his two rules. It changes the stack, and
it makes the two rules structural rather than advisory.

---

## 2. The two rules

Ptacek's rules are about discipline. A tool can enforce them instead.

**Rule One: you may not use a single word the model suggests.**

The app never inserts text into your document. There is no Accept button and no
apply action. A finding is a location plus a description of a problem. The
schema the model fills in has no `replacement` field, so there is nowhere for
suggested prose to go. If a note smuggles wording in anyway — a quoted phrase
that does not appear in your draft — the app redacts that span in the sidebar
and you have to click to reveal it. See §10.

**Rule Two: avoid encouragement.**

The schema has no `assessment`, no `strengths`, no `summary`. Praise has nowhere
to land. The system preamble forbids it as a second line of defence. The A/B
judge (§11) never learns which side you wrote later, and runs on a different
provider with no history of the editing session.

Both rules are configurable, in `[rules]` in `config.toml` (§9.1). The
defaults are strict. The settings exist because the rules are the author's
discipline, not the app's opinion, and because a rule you cannot switch off is a
rule you cannot test. Relaxing one is a deliberate edit to a config file, never
a button in the interface.

---

## 3. Non-goals

- Collaboration, comments from other people, sharing, sync.
- Publishing, export pipelines, CMS integration. Markdown in and out is enough.
- Mobile or web deployment.
- Ghostwriting, outlining, idea generation, "continue my paragraph".
- Accounts, telemetry, monetisation.

---

## 4. Stack

### 4.1 Decision

| Layer | Choice |
|---|---|
| Shell | Tauri v2 (system WebView, ~10 MB app) |
| Frontend | Svelte 5 + TypeScript, built by Vite |
| Editor | TipTap 3 on ProseMirror |
| Native core | Rust: SQLite, anchoring, subprocess, keychain |
| Storage | SQLite via `rusqlite` (bundled) |
| Providers | `genai` in Rust, plus a CLI subprocess backend |
| Toolchain | Bun |

The editor decides the stack. A Notion-style prose editor with span-anchored
margin notes exists in one ecosystem only: ProseMirror/TipTap, Lexical, or
CodeMirror 6. There is no Rust or Elixir equivalent. A webview and a TypeScript
editor layer are therefore fixed costs in every option. The question is only
what wraps them.

Tauri wraps them with the smallest binary, a system WebView, and the plugins
this app needs: `http` (provider calls from the webview without CORS), `dialog`,
`opener`. Rust gets genuine work — storage, the anchoring algorithm in §7, and
the CLI runner in §9.3 — rather than being ceremony around a web app.

Svelte 5 over React: less framework per feature, and TipTap mounts imperatively
in `onMount`, so the lack of an official Svelte binding costs nothing.

### 4.2 Why not the alternatives

**Elixir + Phoenix LiveView + elixir-desktop.** The editor fights it. TipTap
inside a LiveView hook means two state machines over one document: LiveView's
DOM patching and ProseMirror's. You manage it with `phx-update="ignore"` and
hand-rolled event plumbing. OTP's strengths — supervision, concurrency, fault
tolerance — buy little when peak load is a dozen concurrent HTTP calls on one
machine. Packaging and notarising a BEAM app on macOS is more work than
`tauri build`. Reconsider this if the app ever becomes multi-user or hosted.

**Phoenix on localhost, no shell.** Simplest to build and to open source.
Rejected because it is not a desktop app.

**Electrobun.** v1 shipped in February 2026 and 2.0 is current. Small binaries,
4 KB delta updates. Its pitch is "all TypeScript", which points the wrong way
here, and the plugin surface is much smaller than Tauri's.

**Tauri with a Phoenix sidecar.** Gets Elixir into the picture at the cost of
BEAM bundling, a second runtime, and about 30 MB. Not worth it for this.

### 4.3 Verified versions

Checked against the registries on 21 September 2026.

```
npm                                crates.io
@tauri-apps/cli        2.11.5      tauri               2.11.6
@tauri-apps/api        2.11.1      tauri-build         2.6.3
@tauri-apps/plugin-dialog 2.7.3    tauri-plugin-dialog 2.7.3
@tauri-apps/plugin-opener 2.5.5    tauri-plugin-opener 2.5.5
zod                    4.6.5       genai               0.6.5
svelte                 5.57.1      rusqlite            0.40.2
@tiptap/core           3.31.3      strsim              0.11.1
vite                   8.3.0       similar             3.2.0
prosemirror-markdown   1.13.4      keyring             4.2.0
markdown-it            14.1.0      toml                1.1.6
webdriverio            9.32.0      tauri-plugin-wdio-webdriver 1.4.0
prosemirror-search     1.1.1
```

The last two rows were checked on 23 September 2026. `webdriverio` and the
WebDriver plugin are for driving the app in tests and in dev (§16).
`prosemirror-search` does find and replace (§12.6). `webdriverio` is a dev dependency, and a release
build does not register the plugin.

The npm side has no model provider package. Every provider call runs in Rust
through `genai` (§9.2), so the webview neither holds a key nor makes a request.

`serde_yaml` is deprecated, so pass files use TOML frontmatter (§8.1) rather
than YAML, which also means one config language across the project.

---

## 5. Architecture

```
writegood/
├── src/                          TypeScript + Svelte
│   ├── main.ts
│   ├── App.svelte                three-pane shell
│   ├── lib/
│   │   ├── state.svelte.ts       runes store: document, findings, cursor
│   │   ├── ipc.ts                typed wrappers over Tauri invoke
│   │   ├── markdown.ts           Markdown ↔ ProseMirror (§6.1)
│   │   ├── text.ts               ProseMirror doc → plain text + position map
│   │   ├── spans.ts              tidy the edges of drawn ranges (§12.3)
│   │   ├── usage.ts              sum and word what calls cost (§9.4)
│   │   ├── appearance.ts         text size steps, theme toggle (§12.1)
│   │   ├── shortcuts.ts          shortcut labels and the modifier per platform (§12.7)
│   │   ├── hints.ts              the hint steps in the status bar (§12.7)
│   │   ├── palette/Palette.svelte  the only chrome (§12.2)
│   │   ├── editor/
│   │   │   ├── Editor.svelte     TipTap instance
│   │   │   ├── FindBar.svelte    the find bar (§12.6)
│   │   │   ├── findings.ts       decoration plugin for highlights
│   │   │   └── search.ts         find and replace (§12.6)
│   │   ├── sidebar/
│   │   │   ├── Sidebar.svelte    Genius-style margin notes
│   │   │   └── redact.ts         Rule One guard (§10.3)
│   │   ├── passes/
│   │   │   ├── run.ts            orchestration, fan-out, progress
│   │   │   ├── parse.ts          prompt builder, reply parser
│   │   │   ├── deadline.ts       a second timeout behind Rust's
│   │   │   ├── limit.ts          calls in flight, thinking passes first
│   │   │   ├── windows.ts        a long draft split into windows (§8.3)
│   │   │   ├── keys.ts           keys for saved answers (§8.3)
│   │   │   ├── filter.ts         code filters on candidates (§8.3)
│   │   │   ├── verify.ts         the verifier's prompt and vote (§8.3)
│   │   │   ├── jev.ts            passes on Jev: segments, spans, questions (§8.4)
│   │   │   └── schema.ts         Zod finding schema + system preamble
│   │   ├── providers/index.ts    resolve a provider name (the call is Rust's)
│   │   ├── history/History.svelte  revisions sheet and word diff
│   │   └── duel/
│   │       ├── Duel.svelte       A/B compare UI
│   │       ├── judge.ts          shuffle, judge prompt, verdict parser
│   │       └── run.ts            one duel: ask the judge, record the result
├── src-tauri/                    Rust
│   └── src/
│       ├── lib.rs                builder, command registration
│       ├── error.rs              AppError → serialisable strings
│       ├── db.rs                 schema, CRUD, transactions
│       ├── anchors.rs            re-anchoring (§7)
│       ├── config.rs             ~/.writegood config, rules, passes
│       ├── llm.rs                provider calls via genai (§9.2)
│       ├── jev.rs                requests to Jev (§9.5)
│       ├── prices.rs             the price catalog and cost per call (§9.4)
│       ├── diff.rs               word-level diff for revisions
│       ├── log.rs                ~/.writegood/writegood.log
│       ├── menu.rs               the macOS menu bar (§12.2)
│       ├── documents.rs          Markdown files on disk (§6.1)
│       ├── runner.rs             CLI subprocess with timeout
│       └── secrets.rs            macOS keychain via `keyring`
├── e2e/                          end-to-end tests against the real app (§16.2)
└── dev/                          the browser fixture, the probes, drive.ts (§16.3)
```

**Boundary rule.** Rust owns durable state, the filesystem, subprocesses,
string matching and every network call. TypeScript owns the editor,
orchestration, prompt building, parsing and position mapping. Neither reaches
across.

---

## 6. Data model

### 6.1 Markdown is the source of truth

A draft is a Markdown file on disk, in any folder (§6.3). An untitled draft
lives in a recovery file until its first save. The app reads and writes that file and nothing else owns
it. You can edit it in another editor, keep it in git, and delete the database
without losing a word.

The database holds everything the Markdown file cannot: revisions, findings,
runs and duels. If the database is missing it is rebuilt empty and the drafts
still open.

Conversion is explicit and lossless for the subset the editor supports:
paragraphs, headings, emphasis, strong, code, code blocks, blockquotes, lists,
horizontal rules, links and hard breaks. `markdown.ts` wraps
`prosemirror-markdown` with TipTap's node names, which differ (`codeBlock` for
`code_block`, `bold` for `strong`, and so on). Anything outside the subset
round-trips as literal text rather than being dropped.

Saving writes the file first and the revision row second. A failed write is
reported and does not advance the revision history. Files are written through a
temporary file and a rename, and always end with a newline.

### 6.2 Database

SQLite, WAL, foreign keys on. Stored at `~/.writegood/writegood.db`.

```sql
documents(id, path, title, created_at, updated_at, opened_at)

revisions(id, doc_id→documents, parent_id→revisions,
          content_json, content_text, major, label, created_at)

runs(id, doc_id, revision_id, pass_slug, pass_name,
     provider, model, status, error, started_at, finished_at,
     input_tokens, output_tokens, cost_usd)

findings(id, run_id→runs, doc_id, category, severity, note,
         quote, prefix, suffix, status, created_at, superseded_at, chunk_key)

reviews(doc_id→documents, pass_slug, chunk_key, run_id→runs, created_at)

duels(id, doc_id, finding_id→findings, a_text, b_text, a_is_original,
      judge_provider, judge_model, verdict, original_won, reason, created_at,
      input_tokens, output_tokens, cost_usd)

actions(name, done_at)
```

`documents.path` is absolute and unique, and null for an untitled draft. The
row is a pointer and a cache of the title; the file is the document.
`opened_at` orders the recent list (§6.3).

`content_json` is the ProseMirror document, kept so a revision restores exactly.
`content_text` is the flattened text that anchoring and passes work against.

**Revision policy.** Consecutive ordinary saves collapse into the newest row, so
typing does not bury the revisions you marked. Marking a revision major starts a
new row and freezes the previous one. `label` is your note on why it is major.

`findings.status` is one of `open`, `addressed`, `dismissed`, `stale`. Nothing
is ever deleted by the app; `stale` is set by anchoring, not by you.

`findings.superseded_at` is set when a newer answer replaces the finding
(§8.3), or when *clear findings* clears it. The app does not list or
show a superseded finding. The row keeps its status, so a later look at the
database still shows what you addressed and what you dismissed. A database
made before this column existed gains it at startup, with every row null.

`findings.chunk_key` names the answer the finding came from: one paragraph of
one pass, or one document pass over one draft (§8.3). `reviews` records every
answer the runner has saved, including the answers with no findings, so an
unchanged paragraph is not sent again. Its key is `(doc_id, pass_slug,
chunk_key)`. A review row is a cache entry, not a record: the app deletes the
ones that no longer match the draft, and *clear findings* deletes them all.

`actions` records each action the author has taken, once, with the time of
the first. The hints in the status bar read it (§12.7). It belongs to the
author, not to a document.

`duels.original_won` is derived at write time from `verdict` and
`a_is_original`, so the A/B shuffle never has to be unpicked later.

The three usage columns on `runs` and `duels` are nullable (§9.4). A CLI call
reports no tokens, so both counts are null. A call with no known price has
tokens and a null cost. A database made before these columns existed gains
them at startup; the rows it already holds stay null.

### 6.3 Files in any folder

A draft can be any Markdown or text file, in any folder. The system open and
save dialogs choose the file. `~/.writegood/documents` stays as the folder the
dialogs start in when no document is open.

**Dialogs.** Rust shows the dialogs, through `tauri-plugin-dialog`, which is
already a dependency. Rust owns the filesystem, so Rust picks the path as well
as reading it. Two commands:

- `doc_pick_open(from) -> Option<String>` shows the open dialog.
- `doc_pick_save(suggested, from) -> Option<String>` shows the save dialog.

`from` is the open document's path, so the dialog starts in its folder.

These are the native macOS dialogs. The plugin calls `rfd`, which shows
`NSOpenPanel` and `NSSavePanel`. The app draws no file picker of its own.

Both return `None` when the author cancels. Both filter to `.md`, `.markdown`,
`.mdown` and `.txt`. Both start in the open document's folder, or in
`~/.writegood/documents`.

The default extension is `.md`. The save dialog suggests a file name made from
the first level-one heading, through `slugify`, or `untitled.md`. A name typed
with no extension gets `.md`.

**New.** `⌘N` opens an empty untitled draft. It has no file and asks nothing.
The first `⌘S` shows the save dialog. Until then, autosave writes the draft to
a recovery file, `~/.writegood/untitled/<doc id>.md`, so a crash or a quit
loses nothing. The first save to a chosen path deletes the recovery file.
Cancelling the save dialog leaves the draft untitled, and the recovery file
stays.

An untitled draft has a document row, so passes, findings, revisions and the
duel work on it before it has a file.

**Open.** `⌘O` shows the open dialog. A path the database already knows opens
its existing row, with its history and findings. A new path gets a new row.

**Save As.** `⌘⇧S` shows the save dialog and writes the draft to the new path.
The document row moves to the new path, so history and findings follow the
draft. The old file stays on disk, unchanged. Save As onto the path of another
known document is refused with a message, because two rows cannot share a path.

**Major revision.** It moves from `⌘⇧S` to `⌘⌥S`. It still asks what changed.
On an untitled draft it shows the save dialog first.

**Recent files.** The command bar's *open* list becomes *open recent*. It lists
documents the author has opened in writegood, from any folder, newest first,
up to 20. An untitled draft with a recovery file is on the list, so a draft
left behind by `⌘N` or `⌘O` can be found again. A document whose file does not
exist now is left out of the list. Its row is kept. The macOS menu has File >
Open Recent, a submenu with the same list, rebuilt by Rust whenever a document
opens or is saved to a new path. Its items emit `open-doc:<id>`. The frontend
opens that document. It is not a palette command id.

Before another document replaces the draft in the editor, any edit autosave
has not written yet is saved.

**Launch.** The app reopens the most recently opened document. For an untitled
draft that is its recovery file. If that file is missing, or there is none, the
app opens a new untitled draft. This replaces "open the newest file in the
documents folder".

**Database.**

- `documents.path` becomes nullable. Null means untitled. SQLite allows many
  nulls in a unique column, so `unique` stays.
- `documents.opened_at` is new. It orders the recent list.
- Rows are never deleted for a missing file. `forget_missing` is removed. A
  file on an unmounted disk comes back with its history when the disk returns.
  This matches the rule that the app deletes nothing (§6.2).
- The migration rebuilds `documents`, because SQLite cannot drop `not null`
  in place. Existing rows keep their ids, so their revisions and findings stay
  attached.

**Guard.** The webview never names a file to write. `doc_save(id, text)`
writes to the row's path, or to its recovery file. `doc_save_as(id, path,
text)` takes a path, which the save dialog returned, and refuses a path that
another row holds before it writes. `doc_write` is gone.

**A file moved outside the app** gets a new row when it is opened from its new
path. Its old history stays with the old row. Detecting moves is out of scope.

**Text files.** A `.txt` file is read as Markdown and written as Markdown.
Characters that Markdown treats as syntax, such as `*` and `_`, can gain
escapes on the first save. The first save of a `.txt` file shows a line in the
status bar that says so.

**Commands.** `doc_pick_open`, `doc_pick_save`, `doc_open(path)`,
`doc_reopen(id)`, `doc_new`, `doc_save`, `doc_save_as` and `doc_recent`, in
`documents.rs`. The open commands return the row and the text together.

**Removed.** `doc_list`, `doc_read`, `doc_write`, `doc_create`, `doc_rename`,
`doc_delete`, `db_forget_missing` and the title question on *new document*.

**Commands and keys.**

| Key | Palette command | Menu |
|---|---|---|
| `⌘N` | new document | File > New |
| `⌘O` | open… | File > Open… |
| — | open recent | File > Open Recent ▸ |
| `⌘S` | save (the dialog if untitled) | File > Save |
| `⌘⇧S` | save as… | File > Save As… |
| `⌘⌥S` | flag a major revision | File > Save as major revision |

**Status bar.** An untitled draft shows "untitled" where a saved draft shows its
title. The unsaved mark stays on while the draft has no file, because the
recovery file is not the author's file.

**Browser fixtures and tests.** `dev/browser/mock-core.ts` answers the two pick
commands with a fixture path. WebDriver cannot drive a native dialog (§16.1).
A debug build therefore reads `WRITEGOOD_PICK`. It names a file, and both pick
commands return that file's first line and show no dialog. An empty line is a
cancel. The file is read on every pick, so a test can change the answer. The
e2e harness writes it, and each test file opens its draft with `⌘O` through
it, because a fresh home starts on an untitled draft.

---

## 7. Anchoring

This is the hard part. Everything else is CRUD.

A finding points at a sentence you are about to rewrite. It has to survive that.

**Storage format.** W3C Web Annotation text quote selector: the exact `quote`,
plus 32 characters of `prefix` and `suffix`. No offsets are stored. Offsets die
the moment you edit anything above them.

**While the document is open.** ProseMirror's `Mapping` moves decoration
positions through every transaction. This is free and exact. Use it.

**On load, and after any pass.** Re-anchor from the selectors. Rust does the
string matching; TypeScript maps the result back to ProseMirror positions.

**Algorithm** (`anchors.rs`):

1. Search for the quote, case-insensitively. If there are several hits, score
   each one's surrounding text against the stored prefix and suffix and take the
   best. Return `exact: true`.
2. Otherwise, generate candidate windows. Take the longest alphanumeric tokens
   of the quote (4 characters or more, longest first), find where they occur in
   the document, and offset each hit by the token's position within the quote.
   This gives a handful of places the quote could plausibly have moved to,
   instead of scanning the whole document for every finding.
3. Score each candidate at three widths (±25% of the original quote length):
   `0.75 × similarity(window, quote) + 0.25 × context_score`, using normalised
   Levenshtein via `strsim`.
4. Accept the best if the quote similarity is at least 0.60 and the total is at
   least 0.65. Otherwise the finding is **stale**.

Stale is a correct and common outcome. It means you rewrote the sentence, which
is what the app is for. Stale findings grey out; they do not vanish.

**Offsets are Unicode scalar values** — not bytes, not UTF-16 code units — on
both sides of the boundary. TypeScript builds its position table with
`Array.from(text)` so the two agree.

**Position mapping** (`text.ts`): walk the ProseMirror doc collecting text nodes
into a flat string, recording one entry per code point holding its ProseMirror
position. A Rust character offset then indexes straight into that table.

---

## 8. Passes

A pass is one editing prompt, run over the draft, producing findings.

### 8.1 File format

Plain files in `~/.writegood/passes/`, TOML frontmatter, prompt body. Keep the
directory in git. You will rewrite these constantly, and that is the point —
the prompts are the part of this tool that is yours.

```markdown
+++
name = "Buried verbs"
category = "nominalization"
scope = "paragraph"     # or "document"
provider = "anthropic"  # optional; falls back to the default provider
enabled = true
thinking = "high"       # optional; overrides the provider's thinking (§9.1)
timeout_secs = 300      # optional; overrides the provider's ceiling
+++

Find sentences where the action has been turned into a noun instead of being
carried by the verb. "Made a determination" for "determined". "Conducted an
investigation" for "investigated".

For each one, quote the phrase and name the buried verb.
```

`scope = "paragraph"` splits the draft and fans out one call per paragraph, with
the whole draft supplied as context. `scope = "document"` sends the draft once.
Paragraph scope is better for local problems and gives faster first results.
Document scope is needed for anything about order, flow or repetition.

`thinking` and `timeout_secs` override the provider's values for this pass
alone. A pass that needs reasoning over the whole draft, such as paragraph
order, can think while the others do not (§8.3).

`provider` names any provider in `config.toml`, so each pass can run on a
different one. A pass can also carry a `[jev]` table. Only a `jev` provider
reads it, and every other provider ignores it (§8.4).

### 8.2 Starter set

Ship a starter set, clearly marked as a starting point to be replaced. Derived
from *Style: Lessons in Clarity and Grace*, which Ptacek names as the source
worth stealing from:

`nominalization`, `passive-actor`, `sentence-openings`, `filler-words`
(very / really / actually / unfortunately), `repeated-phrasing`,
`paragraph-order`, `topic-flow`, `unearned-metaphor`, `length` (which 750 words
are doing no work).

The starters live in `src-tauri/passes/` and are written into a new home.
Each one states a test to apply, what not to flag, the exact span to quote,
what each severity means, and what the note may say. A fast model over-flags,
so the "do not flag" lists carry most of the weight. `topic-flow` checks links
inside each paragraph, so it runs at paragraph scope. `paragraph-order` is the
one starter with `thinking = "high"`: without reasoning over the whole draft,
it missed most misplaced paragraphs (§8.3). Its ceiling is 300 seconds: on a 5,000-word
chapter it took 145.

### 8.3 Running

The runner queues every call of every enabled pass at once: one call for a
document-scope pass, one per paragraph for a paragraph-scope pass, less the
calls whose answers are saved (below). One limit bounds the calls in flight
across the whole run, at 32. Each provider also has its own limit, set by its
`max_in_flight` (§9.1) and 32 when left out. A call waits first for a slot of
its provider, then for a slot of the run, so a call held back by its
provider's limit does not hold a run slot. A slow provider with a low limit
therefore does not slow the passes on other providers. agy on a Google AI Pro
plan returns rate-limit errors at 16 calls in flight, and not at 8 (§9.3). A
pass takes about as long as its slowest call, not the sum of its calls.
Passes that think are queued first, in both queues, because their calls are
the slowest.

**Two stages for a pass that does not think.** A model with thinking off
answers in one or two seconds, finds nearly every real problem, and reports
about two false ones for each real one. So a pass with thinking off runs in
two stages. This holds for every provider kind, `cli` included, except
`jev`, which has its own procedure (§8.4):

1. **Candidates.** The pass's calls run as usual. Two filters in code then
   drop what cannot be right. A paragraph-scope call keeps only the findings
   whose quote lies in the paragraph it examined. Within a pass, a finding
   whose quote repeats an earlier one is dropped, unless the quote occurs more
   than once in the draft.
2. **Verification.** Three calls, with thinking off, each get the window
   the candidates came from, the pass's rule and the numbered candidates, and
   answer keep or drop for each one. A draft with several windows has one
   verification per window. A candidate stays when two of the three keep it. The verifier answers
   only with candidate numbers and keep flags, so no model wording can reach
   the draft by this path (§2). If no verifier answers, every candidate stays.

A pass with thinking on skips both stages. It has already checked its own
work, and it stores each call's findings as the call returns.

The design was measured on four drafts against 82 reference findings written
by a stronger model. With thinking off for eight passes, verification, and
thinking on for paragraph order alone, F1 was 71–72%, the same as thinking on
for every pass (67–71%). The first findings came after about six seconds
instead of two to three minutes, and a run cost about a sixth as much.

A pass that fails marks its run `error`, keeps whatever arrived before the
failure, and leaves the other passes alone. After its first failed call it
starts no more calls. Its calls already in flight finish, and their findings
are kept, because they are paid for.

**Windows.** A paragraph-scope call does not send the whole draft. It sends
the window its paragraph belongs to.

- A draft of up to 16,000 characters is one window: the whole draft, as
  before. The measurements above were all made in this case.
- A longer draft is split into windows of whole paragraphs. Each window has a
  core of 4,000 to 12,000 characters, and every paragraph is in the core of
  exactly one window. A call examines a paragraph of its window's core.
- Each window also carries up to three paragraphs on either side of its core,
  as context. They overlap the next window's core, and no call in this window
  examines them. The first window has no context before it, and the last has
  none after it.
- A core ends after a paragraph whose FNV-1a hash is divisible by four, once
  the core holds at least 4,000 characters. It also ends before a paragraph
  that would take it past 12,000 characters. A paragraph longer than that is
  a core of its own.

The boundaries depend on the paragraphs' text, not on their positions. An edit
can move only the boundaries near it: the windows before it are unchanged, and
the windows after it usually return to the same boundaries within a few
paragraphs.
Unchanged windows send the same text on the next run, so the provider's prompt
cache still holds them.

Windows bound the input of a call. With the whole draft in every call, a run's
input grows with the square of the draft's length: a 5,000-word chapter with
60 paragraphs sent about 3.4 million tokens. With windows it grows in line
with the length.

A window's text carries the header `--- an excerpt of the draft ---` in place
of `--- the draft ---`. Document-scope passes always send the whole draft.

**Prompt order.** Each prompt is the system preamble, then the draft or the
window, then the pass prompt, then the paragraph to examine. Every call of a
window therefore starts with the same tokens. DeepSeek caches a repeated prefix without being
asked, and charges about a tenth of the input price for the cached part. The
cache holds a prefix only after a call that sent it has finished, so the
first calls of a run all miss it. The pass prompt comes after the draft, as Anthropic's
long-context guidance advises for a long document and a short task. Anthropic
caches only a prefix marked with `cache_control`, which the app does not set.

Findings arrive a pass or a call at a time rather than one finding at a time.
A verified pass stores its findings once, when verification ends. A pass with
thinking on stores each call's findings as the call returns: a document-scope
pass makes one call, and a paragraph-scope pass makes one per paragraph. The
margin shows stored findings at once. No pass waits for another. Both backends end at the same place — a block of text that should contain a JSON
array — and `parse.ts` reads it. Per-element structured-output streaming does
not survive provider switching: an endpoint without structured-output support
returns a bare array where the caller expects a wrapper, and the result is
silently zero findings. One code path with one failure mode is worth more here
than per-element streaming.

An item that fails the schema is dropped, so one malformed entry does not
discard the nine good ones beside it. If *every* item across a whole pass
fails and there was at least one, the pass fails instead: a provider that has
changed its field names must not read as a clean nothing-found. The check
covers the pass, not each reply. A paragraph pass makes one call per
paragraph, and with dozens of calls one reply whose only item is bad is
likely; it must not fail the pass. A genuinely empty array stays silent,
because finding nothing is a normal result.

A reply with no readable array fails only its own call. With thinking off, a
few replies are prose, such as "No problems found.", or a refusal: 11 of
about 790 in one run over a 5,000-word chapter. The call's answer is not saved, so the next run asks it again, and
the pass goes on with its other calls. The status bar counts these replies.
The pass fails only when every reply it got was unreadable. A call that gets
no reply at all, such as a network error or a missing key, still fails the
pass and stops its remaining calls, because the next call would fail the
same way. A pass on Jev is different: a request with no reply fails only its
paragraph (§8.4).

A reply that cannot be read says which of four things went wrong, because each
implies a different remedy:

```
deepseek returned 7 findings, none of which fit the schema: quote: expected string
deepseek's reply ends with an unclosed array, so it was probably cut off
deepseek returned an array that holds no findings
deepseek returned no JSON array
```

The parser looks for an array in every ```json fence, then every plain fence,
then the raw reply, and takes the first non-empty array of objects, else an
empty one. It never falls back to an array of something else: that path
returned zero findings with no error, which is the failure this whole section
exists to prevent.

Every pass prompt contains the word "json". DeepSeek, and other
OpenAI-compatible endpoints, return a 400 for a structured-output request whose
prompt lacks it. Saying so costs nothing elsewhere, and `parse.test.ts` asserts
it so it cannot be edited away.

Every run records which revision it ran against. Findings from an older revision
stay visible, marked with the revision they came from.

**Saved answers.** The runner saves every answer it gets and does not ask the
same question twice. An answer is the findings of one call, after the code
filters and verification, and it is saved even when it holds no findings.

Each answer has a key, a SHA-256 hash:

- A paragraph-scope answer: the pass's fingerprint, the paragraph, and the
  paragraph before it. The previous paragraph is in the key because repeated
  phrasing looks back one paragraph.
- A document-scope answer: the pass's fingerprint and the whole draft.
- The fingerprint covers everything else that can change an answer: the
  system preamble (which carries the rules), the output note, the pass's
  prompt and scope, the provider's name and model, the thinking setting, and
  for a verified pass the verifier's prompt. A pass on Jev has its own
  fingerprint (§8.4).

The rest of a window is context and is not in the key. An edit two paragraphs
away does not send a paragraph again. A finding that depends on distant text
can go stale this way; that is rare for the paragraph checks, and *run all
passes afresh* asks every question again.

Before a pass runs, the runner reads the keys the document already has
answers for (`reviews`, §6.2) and skips those calls. A rerun with no edits
makes no calls for any pass and finishes at once. A rerun after editing three
paragraphs of a chapter asks each paragraph pass about those three and the
paragraph after each, and asks each document pass again.

**A rerun replaces, one answer at a time.** Each finding records the key of
the answer it came from (`findings.chunk_key`).

- Storing an answer supersedes the findings of any earlier answer with the
  same key, and records the key in `reviews`. The two are one transaction.
- When a pass ends without a failure, Rust supersedes the pass's findings
  whose key is not among the draft's current keys, and deletes their
  `reviews` rows. These are findings on paragraphs that changed or went away.
- A pass that fails supersedes nothing at the end. A failed run does not empty
  the margin, and its failed calls are asked again next time.
- Findings from an unchanged paragraph stay as they are, with their status.
  A finding you dismissed stays dismissed until its paragraph changes.
- Findings from a pass that is not in the run stay. A disabled pass keeps its
  findings.
- A finding stored before keys existed has no key. The pass's first keyed run
  supersedes it.
- A run never supersedes the findings of a later answer, so two overlapping
  runs cannot hide each other's results.

The status bar says how many answers were reused, for example "3 new findings
· 41 answers reused". With reused answers the margin holds more than the run
found, so the count says "new". *run all passes afresh*, in the command bar, ignores the
saved answers and asks every question again.

### 8.4 Passes on Jev

Status: method `sentence` built on 23 September 2026. Method `across` is
specified and not built.

Jev is TypeSafe's decision model (§9.5). It does not write text. It answers
typed questions about a text that the caller sends as `state`. A Noul returns
the probability that the answer is yes. A Choice picks one option from a list
that the caller supplies, and returns a probability for each option. A
paragraph-scope pass can run on Jev instead of a language model. The pass
names a `jev` provider in its frontmatter, as any pass names its provider
(§8.1).

**The rule text is the whole definition.** Jev reads the prompt body of the
pass, word for word, as its criterion. One pass file serves a language model
and Jev. No word list, regular expression, suffix pattern or
language-specific code decides what is flagged. Code does four things only:

1. It splits a paragraph into sentences and a sentence into words, with
   `Intl.Segmenter` and no locale set. A word is a segment that the
   segmenter marks `isWordLike`.
2. It lists spans of consecutive words as the options of a Choice.
3. It turns the chosen option into a quote, from the offsets it listed.
4. It removes spans that overlap a span already chosen.

The same pass files therefore work in any language that the Unicode break
rules can split. Jev itself is less accurate outside English (§9.5).

**Frontmatter.** A pass on Jev reads a `[jev]` table. A table must come after
the plain keys in TOML, so it is the last part of the frontmatter.

```toml
+++
name = "Filler words"
category = "filler-words"
scope = "paragraph"
provider = "jev"
enabled = true

[jev]
method = "sentence"   # or "across"
keep = 0.5            # optional; else the provider's keep, else 0.45
note = "A word or phrase that adds emphasis or hedging and no meaning."
+++
```

- `method` chooses one of the two procedures below. The default is
  `sentence`.
- `keep` is the keep threshold. A Noul answer at or above it keeps the
  sentence. The value in the pass wins over the provider's `keep` (§9.5). If
  neither sets one, the threshold is 0.45. The benchmark used 0.45 for every
  pass except filler words, which used 0.5. Every pass it probed gave a real
  reference hit a score between 0.42 and 0.49 at least once. So 0.45 is a
  compromise, not a tuned value.
- `note` is the note on every finding of the pass. The author writes it.
  Jev writes nothing, so no model word reaches the margin or the document
  (§2). If `note` is left out, the note is the pass's `name`.

**Method `sentence`.** The benchmark calls this Method 2. For each paragraph:

1. **Detect.** One request, whose state is the paragraph. It holds one Noul
   per sentence, keyed `s0`, `s1` and on. Each Noul carries the rule text, the paragraph and the
   sentence. It asks whether the sentence itself shows the problem that the
   rule defines, with every exclusion in the rule applied. A sentence whose
   answer is below `keep` is done.
2. **Locate.** For each sentence that is kept, one request with one Choice.
   The options are every span of one to eight consecutive words of the
   sentence. The description of each option is the exact text of its span.
   The Choice asks which option is exactly the text that the rule says to
   quote. An option's key is the indices of its first and last word, such
   as `3-5`. A Choice takes at most 255 options. For a sentence with more
   spans than that, the longest length leaves the list first, until the list
   fits. A sentence of more than 255 words keeps its first 255 single words.
   Each later round removes at least the span it chose, so the list and
   `none` still fit.
3. **More instances.** A sentence can hold more than one problem. Up to three
   more rounds follow, one request each. Each round names the quotes already
   chosen, removes the spans that overlap them, and adds the option `none`. A
   round that picks `none` ends the sentence.

The limit of eight words sets the longest quote. It does not decide what is
flagged. The question texts are the ones the benchmark measured, in
`run-rule-choice.ts`, word for word.

**Method `across`.** Status: specified, not built. A pass with `method =
"across"` fails at once, with a message that says so. This is the
cross-sentence variant. It is for a rule
whose problem can lie across sentences. Sentence openings uses it: a run of
three sentences that open the same way is in no single sentence. It runs
method `sentence` unchanged. It also asks, for each paragraph of two or more
sentences:

1. **Detect.** One Noul. It carries the rule text and the sentences of the
   paragraph, in order. It asks whether the problem lies across two or more
   of the sentences, in a way that no single sentence shows. Below `keep`,
   the paragraph is done.
2. **Choose the sentence.** One Choice. Its options are the sentences of the
   paragraph. It asks which sentence holds the text that the rule says to
   quote.
3. **Locate.** One Choice over the spans of that sentence, as in step 2 of
   method `sentence`.

In method `across`, every Choice over spans also offers each span that
starts at the first word of the sentence, at any length. A rule about
openings quotes an opening, and an opening can be longer than eight words.
The code offers positions. The rule text still chooses among them.

The benchmark script for sentence openings differs from this variant in
three ways, and each one put part of the definition in code. Its questions
named the two problems of the sentence-openings rule. It found the length of
a run with pairwise Nouls and a count. It counted the words before the
subject against the rule's numbers. This spec removes all three.

The variant here was measured on 23 September 2026
(`bench/results/2026-09-23-jev-across.md`). With the clearer wording below
it scored 72.7% in both runs. DeepSeek, with the same wording, scored 90.9%
and 66.7%, a mean of 78.8%. So sentence openings stays on the language
model, and method `across` is not built.

**Findings.** Each chosen span is one finding.

- `quote` is the exact text of the span in the draft. Jev never supplies
  text, so a quote cannot hold a word that is not in the draft.
- `prefix` and `suffix` are the 32 characters on each side of the span in
  the draft, counted in Unicode scalar values (§7).
- `category` is the pass's `category`. `note` is the pass's `jev.note`.
- `severity` comes from the Noul that kept the sentence or the paragraph:
  `high` at 0.85 or more, `medium` at 0.65 or more, else `low`. This measures
  how sure Jev is, not how serious the problem is (§15).

Nothing in a Jev answer is text, so there is nowhere for praise to go. An
answer with no finding shows "no findings".

**Where the code lives.** TypeScript does the segmenting, lists the spans,
builds the questions, reads the answers and makes the findings, in
`src/lib/passes/jev.ts`. Rust makes the request (§9.5). This follows the
boundary rule (§5):

- Segmenting and listing spans build the questions. Building a prompt is
  TypeScript's work, and a question list is Jev's prompt.
- Reading the answers is parsing, which is TypeScript's work. Rust passes
  the answers back without reading them.
- Nothing searches the draft for a string. Each quote comes with the offsets
  that code listed. So no string matching moves out of Rust. Anchoring after
  a reload still goes through `anchors.rs` (§7).
- The benchmark measured `Intl.Segmenter`, which WebKit provides. A Rust
  segmenter, such as `icu_segmenter`, is a new dependency, and its breaks
  could differ from the ones measured.
- `dev/probe.ts` can run the same TypeScript against a real key, as it does
  for the other passes.

`Intl.Segmenter` reports offsets in UTF-16 code units. `jev.ts` uses them
only to cut strings from the paragraph it segmented. The offsets never cross
the boundary. `prefix` and `suffix` are cut with `Array.from`, so they hold
whole scalar values.

**How the runner treats a Jev pass.** It runs in the runner of §8.3, with
these differences only:

- A Jev pass has paragraph scope. A Jev pass with `scope = "document"` fails
  at once, with a message that says so. So does a `[jev]` table with an
  unknown method or a keep outside 0 to 1.
- One answer is one paragraph: every request for that paragraph. The runner
  saves the answer when its last request returns.
- The state of each request is the paragraph alone. No window and no draft
  go with it, so windows (§8.3) do not change what Jev sees.
- A Jev pass has no candidates and no verifier. The keep threshold does the
  work of the verifier. The code filters of stage 1 hold by construction:
  every quote lies in its paragraph, and two equal quotes are two different
  spans.
- A Jev pass counts as a pass that does not think, for the order of the
  queue.
- Each request is one call. It waits for a slot of its provider
  (`max_in_flight`, §9.1) and then for a slot of the run, as every call
  does.

**Saved answers.** The key of a Jev answer has the form of any paragraph
answer: the fingerprint of the pass, the paragraph, and the paragraph before
it. `passKeys` computes it, so the markers of unchecked paragraphs (§12.4)
need no change. The fingerprint of a Jev pass covers:

- the rule text and the category;
- the `[jev]` table, after the defaults apply: method, keep threshold and
  note;
- the provider's name and model;
- the fixed question texts of the method, and its constants: eight words,
  four rounds, and the severity bands.

The system preamble and the output note do not go to Jev, so they are not
in the fingerprint. A change to anything in it asks every paragraph again. A
rerun replaces one answer at a time, as in §8.3. *run all passes afresh*
asks every question again.

**Failures** follow §8.3, except for a request with no reply.

- A reply that cannot be read fails only the answer of its paragraph. This
  covers a body that is not JSON, a body with no `answers`, a missing
  answer, an answer of the wrong type, and a Choice outside the options. The runner does not save the
  answer, and the next run asks it again. The status bar counts it with the
  unreadable replies.
- A request with no reply also fails only the answer of its paragraph. This
  covers a network error, a missing key and an HTTP error that retries did
  not clear (§9.5). The runner does not save the answer, and the next run
  asks it again. The pass goes on with its other paragraphs. The status bar
  counts these as failed calls.
- The pass fails only when every paragraph it asked about failed, by either
  rule. It then keeps the answers already complete. A missing key fails
  every request, so it still fails the pass.
- An answer that the runner cannot save fails the pass. The pass then starts
  no more requests.

**Which passes.** Filler words runs on Jev. Sentence openings stays on the
language model: method `across` scored below DeepSeek (above).
Nominalization and missing actor stay on the language model for now. The
other five starters have not been tried with the rule text alone.

Measured on the four scored drafts, two runs each, on 23 September 2026
(`bench/results/2026-09-23-followup.md`). The DeepSeek column is
`deepseek-flash` direct, thinking off, with the verifier.

| Pass | Jev method | Jev F1 | DeepSeek F1 | Jev requests per draft | Jev cost per draft |
|---|---|---|---|---|---|
| filler-words | `sentence`, keep 0.5 | 83.7%, 85.7% | 74.3%, 68.4% | 20 | $0.0022 |
| sentence-openings | benchmark script, clearer wording | 100%, 88.9% | 44%, 60% | 40 | $0.0018 |
| sentence-openings | `across`, clearer wording | 72.7%, 72.7% | 90.9%, 66.7% (clearer wording) | 19.5 | $0.0018 |
| passive-actor | `sentence`, keep 0.45 | 73.7%, 70.0% | 60.0%, 57.1% | 13 | $0.0015 |
| nominalization | one Noul per sentence, the quote is the sentence | 73% (mean) | 92% (earlier run) | ~9 | ~$0.0011 |

- Filler words found every reference item in both runs. All 18 hits in each
  run quoted exactly the reference words. A draft took 6.2 seconds.
- Sentence openings used the clearer exclusion wording below. Both runs
  flagged no run of sentences that share only a pronoun. The earlier wording
  flagged two such runs in each run.
- Missing actor moved by less than the spread between its runs. Four of its
  seven hits quoted the verb group without the short subject that the rule
  asks for, such as "had been promised" for "Sandbags had been promised".
- Nominalization was measured only with whole sentences as quotes. It
  scored 19 points below the language model.

Jev's answers vary between runs with the same settings: 83.7% and 85.7% for
filler words, 100% and 88.9% for sentence openings, 66.7% and 73.7% for
missing actor with one Noul per sentence. Two runs are a small sample.

Filler words on Jev also ran over the 5,038-word chapter: 115 requests in
7.4 seconds for $0.013, with no error. The largest request used 8,661 input
tokens, 14% of the limit.

**The starter set.** `03-sentence-openings.md` takes the clearer exclusion
wording measured above. A run by construction becomes "the same
introductory phrase or clause before the subject". The exclusion becomes:
sentences that share only their first word, when that word is an article or
a pronoun, are not a run. It gives the example "He opened the door. He sat
down. He waited." and says that a subject followed by its verb is not a
shared construction. This also changes the pass on a language model. On
DeepSeek the new wording raised the mean F1 from 66.7% to 78.8% over two
runs, and flagged no run that shares only a pronoun.

`04-filler-words.md` gains a `[jev]` table with `method = "sentence"`,
`keep = 0.5` and a note. It does not name the `jev` provider, because a new
home has no TypeSafe key. The author adds `provider = "jev"`. Without it the
pass runs on the default provider as a prompt, and the table is ignored.
`03-sentence-openings.md` gains no `[jev]` table. The starters are written
into a new home only, so an existing home keeps its pass files.

The recommended setup names three providers:

- `default_provider = "deepseek"` in `config.toml`, for the fast passes;
- `provider = "jev"` in `04-filler-words.md`;
- `provider = "gemini"` in `06-paragraph-order.md`.

Each pass already names its own provider (§8.1), so this needs no new
mechanism.

---

## 9. Providers

### 9.1 Configuration

`~/.writegood/config.toml`. Editable by hand; the palette opens it. When the
app saves a setting, such as the theme or the text size, it changes that value
in place. Comments, blank lines, key order and keys the app does not know stay
as the author left them.

Keys resolve from the keychain (`keychain:service/account`) or the environment
(`env:NAME`). An `env:` reference also falls back to a `.env` file, looked for
in `$WRITEGOOD_HOME` and then the working directory and its parents. An app
launched from Finder inherits almost nothing from a shell, so a `.env` is the
only reliable way to hand a key to a desktop build.

```toml
default_provider = "anthropic"
judge_provider   = "openai"      # must differ from the pass provider (§11)

[rules]
# Rule One. Defaults keep the model's wording out of your draft entirely.
allow_suggestions   = false  # true adds a replacement field and an apply action
redact_suggestions  = true   # block wording that leaked into a note (§10.3)
# Rule Two.
forbid_praise       = true   # the no-encouragement preamble
blind_judge         = true   # shuffle A/B, strip history, require a second vendor

[appearance]
font        = "ui-serif"
font_size   = 19
measure     = 68             # characters per line
theme       = "light"        # light | dark | system
show_cost   = false          # the file's running cost in the status bar (§9.4)

[providers.anthropic]
kind    = "anthropic"
model   = "claude-opus-5"
key_ref = "keychain:writegood/anthropic"

[providers.openai]
kind    = "openai"
model   = "gpt-5.2"
key_ref = "env:OPENAI_API_KEY"

[providers.local]
kind     = "openai-compatible"
base_url = "http://localhost:11434/v1"
model    = "qwen3:32b"
catalog  = "ollama"          # its id in the price catalog, when the name differs (§9.4)

[providers.claude-cli]
kind    = "cli"
command = "claude"
args    = ["-p", "{prompt}", "--output-format", "json"]
json_path = "result"        # extract this field from stdout, then parse
thinking = "off"            # not in the command; the pass runs with the verifier
timeout_secs = 180

[providers.jev]
kind    = "jev"
model   = "jev-1.13.0"
key_ref = "env:TYPESAFE_API_KEY"
price   = { input = 0.042, output = 0 }   # when models.dev has no price (§9.4)
```

`[rules]` is the one place the two rules can be relaxed (§2). Turning
`allow_suggestions` on changes the finding schema and adds an apply action;
everything else in the app is unaffected. `blind_judge = false` lets the judge
share a vendor with the pass, which makes the duel results worth less.

`[appearance]` is read at startup and on file change. `font` accepts any
family installed locally, or the `ui-serif` / `ui-sans-serif` / `ui-monospace`
keywords.

`kind` selects the backend. Anything with an API key goes through `genai` in
`llm.rs` (§9.2); `cli` shells out; `jev` calls TypeSafe's endpoint from
`jev.rs` (§9.5). A `jev` provider runs only passes written for Jev (§8.4).

`thinking` sets how much a reasoning model thinks before it answers: `off`,
`low`, `high` or `max`. Left out, the provider's own default applies. A pass
can override it (§8.1). `off` turns thinking off: an `openai-compatible`
provider gets DeepSeek's `thinking: {"type": "disabled"}` field, `openai` and
`google` get the reasoning effort `none`, and `anthropic` gets no thinking,
which is its default. The other values go to the provider as its reasoning
effort; an `openai-compatible` provider also gets `thinking: {"type":
"enabled"}`. A `cli` provider passes the value to its command only through
the `{thinking}` placeholder (§9.3), and otherwise ignores it.

`price` gives the provider's rates, in US dollars per million tokens:
`input` and `output`, and optionally `cache_read` and `cache_write`. The app
uses it only when the price catalog has no price for the model (§9.4). Any
provider can set it.

`max_in_flight` caps how many calls to this provider run at once. Left out,
it is 32. Calls to other providers do not count against it, and the run as a
whole still never has more than 32 calls in flight (§8.3).

```toml
[providers.deepseek]
kind     = "openai-compatible"
base_url = "https://api.deepseek.com/v1"
model    = "deepseek-flash"
key_ref  = "env:DEEPSEEK_API_KEY"
thinking = "off"
```

With thinking at `high`, DeepSeek Flash spends 10,000 to 15,000 tokens and
40 to 60 seconds on one paragraph. `low` saves almost none of that. `off`
answers the same call in one or two seconds with a few hundred tokens. A pass names a provider or inherits `default_provider`. The header
bar also has a provider override for the current session, which wins over both.
An override that names a `jev` provider applies only to paragraph-scope
passes that have a `[jev]` table (§8.4). The other passes keep their own
provider. An override that names any other provider applies to every pass,
the Jev passes included, because a pass file is also a prompt.

### 9.2 Network backend

`genai`, in `llm.rs`. It is the nearest Rust equivalent of the AI SDK's core:
one call shape across Anthropic, OpenAI, Gemini, DeepSeek, Ollama, OpenRouter
and the rest, with a `ServiceTargetResolver` for anything else. A provider's
`kind` chooses the adapter, `base_url` overrides the endpoint for the
`openai-compatible` kind, and `key_ref` supplies the key. `tokio::time::timeout`
enforces `timeout_secs`.

`genai` joins `chat/completions` onto `base_url` as a relative URL, which
replaces the last segment of a path with no slash at the end. The app adds
that slash before it hands the URL over. So `https://openrouter.ai/api/v1`
and `https://openrouter.ai/api/v1/` both reach
`https://openrouter.ai/api/v1/chat/completions`. Without the slash,
OpenRouter answered 404 to every call. `https://api.deepseek.com/v1` reaches
`https://api.deepseek.com/v1/chat/completions`, the endpoint `genai`'s own
DeepSeek adapter uses.

**Why not in the frontend.** It was, through the AI SDK, and that was wrong.
macOS suspends a WebKit process whose window is not visible, and a pass then
stops mid-run: no request, no CPU, and the timer meant to enforce the timeout
does not fire either. A tokio task is not suspended. Moving the call also keeps
API keys out of the webview and makes the boundary rule in CLAUDE.md true
rather than aspirational.

The frontend still builds the prompt and parses the reply, so the preamble, the
rules and the parser keep their tests.

Cost is not a constraint. A 2,000-word draft is roughly 2,700 tokens. Twelve
passes is about 36k input and 18k output tokens — under a dollar at
`claude-opus-5` rates ($5 / $25 per million).

### 9.3 CLI backend

The reason to have it is billing: `claude` and `codex` run against your
subscription rather than API credits.

`runner.rs` spawns the configured command with `tokio::process`, substitutes
`{prompt}`, applies the timeout, and returns stdout. If `json_path` is set it
parses stdout as JSON and takes that field, then extracts the first fenced JSON
block from the text. Structured output is less reliable here than through the
API, so the parser tolerates a preamble and trailing chatter, and a pass whose
output will not parse fails cleanly rather than half-loading.

**An empty working directory.** Every call of every `cli` provider runs in a
new, empty temporary directory, `claude-cli` included, and `runner.rs` deletes
it when the call ends. A command that is an
agent, such as `agy`, reads rules and files from its working directory, and it
must find none of the author's. The `{workdir}` placeholder in `args` is that
directory's path.

**Files in the directory.** `[providers.<name>.files]` maps a path inside the
directory to the text written there before the command starts. A path must be
relative and must not contain `..`. agy uses this for a custom agent with no
tools and a hook that denies every tool.

**Placeholders.** `{model}` is the provider's `model`. `{thinking}` is the
call's thinking level: the pass's `thinking`, else the provider's (§8.1). The
level goes to the command as written, so the args decide what it means. A
call whose args use `{thinking}` or `{model}` with no value set fails with a
message that names the missing key.

**Thinking names.** `thinking_names` maps a level to the text that
`{thinking}` becomes, for a command that names its levels differently or
lacks one. A level with no entry goes to the command as written. agy has no
`-off` and no `-max` model, so its config maps `off` to `low` and `max` to
`high`. A pass with thinking `off` still counts as not thinking: it runs in
two stages, with the verifier (§8.3).

**Errors inside JSON.** Some commands exit with 0 and report a failure in their
JSON. agy does this for a rate-limit error, and its `response` field may still
hold a complete-looking `[]`. `json_error` names a field. When that field is
present and is not `null`, `false` or an empty string, the call fails with its
text. A failed call saves no answer, so the next run asks it again.

**agy.** Google's Antigravity CLI runs Gemini on a Google AI subscription. It is
an agent: by default it has a shell, file tools and the author's MCP servers,
and it reads `GEMINI.md` and `AGENTS.md`. Without a workspace it writes to its
own scratch folder, which the empty directory does not prevent. Two guards
turn this off, and both come from files in the empty directory:

- `--agent writegood` selects a custom agent with no tools, no MCP servers, no
  inherited rules or skills, and none of agy's default prompt. That also cuts
  the input of a call from about 15,000 tokens to the size of the prompt.
- `.agents/hooks.json` denies every tool call, in case the agent file stops
  being read.

`--add-dir {workdir}` makes the directory agy's workspace, which it needs to
read both files. A test prompt that asked for a shell command, a file write
and a Linear lookup got a reply in words, and no file appeared.

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

agy's model names carry the thinking level: `gemini-3.8-flash-low`, `-medium`
and `-high`. There is no level without thinking, but `-low` used no thinking
tokens on a paragraph call. Without `thinking_names`, a pass whose `thinking`
is `off` or `max` names a model agy does not have, and fails. Paragraph order
sets `high` and runs on `-high`. Each call starts a new agy process, which
adds about two seconds.

Measured on the four scored drafts (bench, 23 September 2026), two runs:

- Fast passes on `-low`, paragraph order on `-high`, with the verifier: F1
  77–79%, against 71–72% for DeepSeek Flash in the same pipeline.
- The same replies without the verifier: F1 68–69%, precision 54%, recall
  91–95%. The app therefore verifies a `cli` pass that does not think, as it
  does for any other provider.
- A fast call takes about 4.6 seconds (median), against one to two for
  DeepSeek. Paragraph order on `-high` takes 80 to 125 seconds.
- 8 calls in flight gave no errors. 16 gave five rate-limit errors in 347
  calls. The plan charges nothing per call.

agy also works as the duel judge (§11). `runDuel` sends a `cli` judge the
judge's system text and prompt as one prompt, through the same runner and
guards. Tested on 23 September 2026 with DeepSeek as the pass provider: two
memo paragraphs, each against a version with its reference problems fixed by
hand, ten calls per pair, each order five times. The judge chose the fixed
version in 20 of 20 calls, in both orders. No reply was unreadable. A call took
about 4.5 seconds (median; 3.8 to 8.2), and every call ended in one turn with
no tool call. `dev/probe-duel.ts` cannot run a `cli` judge, because its probe
binary calls `llm::chat` only. The test called the runner through
`examples/cli.rs` with the same prompt `runDuel` builds.

Both backends satisfy one interface:

```ts
type PassBackend = (req: {
  system: string;
  prompt: string;
  signal: AbortSignal;
}) => AsyncIterable<Finding>;
```

### 9.4 Usage and cost

Every network call reports what it used, and the app keeps a running cost for
each file.

**Tokens.** `genai` returns a `Usage` with every reply. `llm_chat` returns it
alongside the text instead of discarding it: input tokens, output tokens, and
the cache reads and cache writes within the input. `genai` counts cache tokens
inside `prompt_tokens` for every vendor, Anthropic included, so the uncached
input is `prompt − cache read − cache write`. Reasoning tokens are already
inside the output count and are not charged twice.

**Prices.** A provider reports tokens, never money. Prices come from
[models.dev](https://models.dev): one public file, `api.json`, no key, rates in
US dollars per million tokens for input, output, cache read and cache write.
`prices.rs` keeps a slim copy, just provider, model and rates, at
`~/.writegood/prices.json`. It refreshes the copy in the background at startup
when it is older than seven days, and keeps the old copy when the fetch fails.
A pass never waits on the catalog and never fails because of it.

llmcatalog.dev was the alternative. Its API serves price history one model at a
time, with no bulk catalog, so it cannot answer "what does this model cost" in
one lookup.

**Matching a provider.** The catalog is keyed by vendor id and model id. The
provider's own table name is the vendor id unless `catalog` says otherwise;
`kind` cannot be used, because `openai-compatible` names a protocol, not a
vendor. The model id is `model`, matched exactly.

**Cost of one call.**

```
  uncached input × input
+ cache reads    × cache_read   (input rate when the catalog has none)
+ cache writes   × cache_write  (input rate when the catalog has none)
+ output         × output
  ─────────────────────────────
  ÷ 1,000,000
```

Tiered pricing, where a long context costs more, is ignored and the base tier
is used. That undercounts only prompts past the tier boundary, 200k tokens for
the models that have one, which no pass comes near.

**Storage.** The frontend adds up the calls in a run and writes the totals to
the run's row when it finishes. The duel writes its judge call to the duel's
row. A file's cost is the sum over its runs and duels.

**Display.** Off unless `show_cost` is on. The status bar then shows the open
file's running total:

- every call priced: `$0.042`
- no call priced: `18,400 tokens`
- some of each: `$0.042 · 3,100 tokens unpriced`

The app never guesses a price. A model the catalog does not know, or a catalog
that has never loaded, uses the provider's `price` from `config.toml` (§9.1).
With no `price` either, the call shows tokens and no money. The catalog wins
when it has a price, because it follows the vendor's changes and a price in
`config.toml` does not.

### 9.5 Jev

Status: built on 23 September 2026.

Jev is TypeSafe's decision model. It answers Noul, Choice and Score
questions about a `state`, and it writes no text. §8.4 says how a pass uses
it. This section covers the provider and the call.

```toml
[providers.jev]
kind          = "jev"
model         = "jev-1.13.0"         # a version, not the alias jev-latest
key_ref       = "env:TYPESAFE_API_KEY"
keep          = 0.45                 # optional; a pass's [jev] keep wins
max_in_flight = 8
timeout_secs  = 60
price         = { input = 0.042, output = 0 }   # when models.dev has none
```

**The call.** `jev.rs` makes it, through the command `jev_ask(name,
provider, state, questions)`. `name` is the provider's table name, which
finds its price. Rust makes every network call (§5), and a tokio task is
not suspended with the window (§9.2). The request is `POST
https://api.typesafe.ai/v1/systemone` with the body `{state, model,
questions}` and the key as a bearer token. `base_url` overrides the address.
`base_url` replaces `https://api.typesafe.ai/v1`, and the request goes to
`{base_url}/systemone`. `genai` has no adapter for this API, which is not a
chat API. `reqwest` makes
the request. It is already a dependency, for the price catalog.

Rust does not read the questions or the answers. It sends the questions as
TypeScript built them. It returns the `answers` object as JSON, the token
counts, the cost, and the `model` field of the response. TypeScript reads the
answers (§8.4). Rust writes the answering model's version to the log. A body
that is not JSON, or that has no `answers` object, comes back with
`answers` null and an `unreadable` message, so TypeScript counts it as an
unreadable reply. A body with an `error` field that is not null fails the
call.

**The key** resolves as for every provider (§9.1): `keychain:service/account`,
or `env:TYPESAFE_API_KEY` with the `.env` fallback. A missing key is Rust's to
report, before any request, as for the other kinds.

**The model** is required. Use a version such as `jev-1.13.0`. The alias
`jev-latest` moves to a new version without notice. The fingerprint (§8.4)
holds the name, not the version, so the answers saved under an alias would
not be asked again after it moves.

**Timeouts and retries.** `timeout_secs` defaults to 60, the ceiling the
benchmark used. `tokio::time::timeout` enforces it. On HTTP 429 or 529, Rust
waits and tries again, up to four attempts in all. It waits 0.5 seconds,
then 1, then 2, or the time a `retry-after` header gives. Every attempt falls
inside the one ceiling. Any other HTTP error fails the call at once, with the
status and the start of the error body. TypeSafe gives its limits as 1,200
requests per minute and 250,000 tokens per second, and says they can change
without notice. The benchmark used 8 requests in flight with no rate-limit
error.

**Settings with no meaning here.** `thinking` and `thinking_names` do not
apply. A `jev` provider ignores them, and they are not in its fingerprint.
A `judge_provider` that names a `jev` provider is refused with a message,
because Jev cannot write a verdict and a reason.

**Limits of a request.** A Choice takes at most 255 options. A request takes
at most 64,000 tokens, and 32,000 for the state and its longest question. A
paragraph with one Noul per sentence carries the paragraph and the rule text
once per sentence. The four scored drafts stayed below the limit. A request
over the limit gets an HTTP error and fails its paragraph (§8.4, §15).

**Usage and cost.** The response gives `input_tokens` and `output_tokens`.
They go into the usage of the call (§9.4) as input and output, with no cache
counts. TypeSafe charges $0.042 per million input tokens, and output is free
(Models page, 23 September 2026). The cost comes from the price catalog, as
for every provider (§9.4). The vendor id is the table name, unless `catalog`
names another. models.dev did not list TypeSafe on 23 September 2026, so the
example config sets `price`. Without either, the status bar shows tokens and
no money.

**Language.** English is Jev's main training language. TypeSafe says other
languages are "handled but not equally well". The benchmark translated one
draft into Spanish and ran it with the English pass files and one Noul per
sentence. Three passes together scored F1 67% in Spanish, against 74% in
English on the same draft. Filler words held best, at 75%.

---

## 10. The findings contract

### 10.1 Schema

```ts
const Finding = z.object({
  quote:    z.string().min(2).max(400).describe("Exact text from the draft, copied verbatim, at most 400 characters."),
  prefix:   z.string().describe("The 32 characters immediately before the quote, verbatim."),
  suffix:   z.string().describe("The 32 characters immediately after the quote, verbatim."),
  category: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  note:     z.string().describe("What is wrong with this text. Name the problem. Do not write a replacement."),
});
```

There is no field for suggested wording and no field for praise.

The note appended to every pass prompt names the three severity values and
says that no other value is allowed. Without it, DeepSeek wrote `moderate` and
`minor`, the schema rejected them, and a whole call's findings were lost.

### 10.2 System preamble

Prepended to every pass, ahead of your prompt:

```
You are a copyeditor examining a draft. You report problems. You do not fix them.

Rules, without exception:
- Never suggest replacement wording. Never write an improved version of any
  sentence, phrase or word. Name the problem and stop.
- Never praise, encourage, compliment or reassure. No positive assessment of
  any kind, at any scale, including in passing.
- Do not comment on the subject matter or on whether you agree with it.
- Quote verbatim from the draft. Never paraphrase a quote.
- Finding nothing is a normal result. Return an empty array.
```

### 10.3 The redaction guard

Models leak suggested wording into prose notes even when told not to. The guard
(`redact.ts`) is mechanical: find quoted spans in a note of three words or more;
if a span does not appear in the draft, it is the model's own wording. Render it
as a block and require a click to reveal.

This makes breaking Rule One a deliberate act rather than an accident of
reading. The reveal is per-span and never sticky.

---

## 11. The duel

Ptacek's third step: rewrite the paragraph, then ask a model which version is
better — and ask a model that does not know you just rewrote it.

1. Pick a paragraph. The app copies the current text as version A.
2. You rewrite it in a plain box. That is version B. **You** write it; the app
   does not produce a candidate.
3. The app shuffles A and B, strips every marker of which is which, and sends
   them to `judge_provider` in a fresh session with no pass history, no
   findings, and no mention of editing.
4. The verdict is recorded with `a_is_original`, so `original_won` is known
   without the judge ever being told.

The judge must be a different vendor from the pass that raised the finding. The
app warns when `judge_provider` and the pass provider resolve to the same
vendor. This is the concrete reason multi-provider support is load-bearing
rather than a convenience.

Over time the duels table answers a useful question: how often does your rewrite
actually beat your first draft? If it is near chance, your passes are wasting
your time.

---

## 12. User interface

### 12.1 Layout

Quiet, classic, text first. The reference points are iA Writer and Japanese
minimalism: nothing on screen that is not text or a response to text. No icons,
no toolbar, no in-app menu bar, no buttons where a keystroke will do.

The rule is about the window. Nothing inside the window is chrome. The macOS
menu bar is outside the window, in the system bar, so it costs the document no
space and the app fills it in (§12.2). Windows and Linux draw a menu inside the
window frame, above the text, so those platforms get no menu at all.

**Type.** Noto Serif, bundled as a variable font with weight and width axes,
in four woff2 subsets (latin and latin-ext, roman and italic), about 915 KB.
The body is 16px, width 100, weight 250, on a 1.66 line, with a fixed measure
of about 68 characters and generous margins. `ui-serif` and Georgia follow it
in the stack, and `[appearance] font` overrides the whole thing. Bundled
rather than fetched, because the app must work with no network.

Headings step from H1 down towards the body:

| Level | Size | Width | Weight |
|---|---|---|---|
| H1 | 36px | 95 | 300 |
| H2 | 30px | 96 | 290 |
| H3 | 25px | 97 | 280 |
| H4 | 21px | 98 | 270 |
| H5 | 18px | 99 | 260 |
| H6 | 17px | 100 | 250 |

Sizes are set in `em` against the body, so the ratios hold at any text size.

**Size.** `⌘+` and `⌘-` change the text size by 1px, from 12px to 32px. `⌘0`
returns it to the base size, 16px. The size is `[appearance] font_size`, and
every change is saved to `config.toml`, so the next launch opens at the same
size. The body, the margin and the chrome all scale together: the margin and
the chrome are set in `em` and `rem` against the body size.

**Colour.** Each theme sets its accent colours from a palette. The light theme
also takes its paper from its palette. The dark theme keeps its neutral dark
paper, `#16161A`, and its greys.

| Role | Variable | Light | Dark |
|---|---|---|---|
| Paper | `--paper` | `#FFF6DC` | `#16161A` |
| Headings and list markers | `--primary` | `#425B9A` | `#FF467A` |
| "You are here": the bar beside the selected note, its category, the selected revision, the duel's verdict, the working state | `--accent` | `#425B9A` | `#FFD51E` |
| Caret | `--caret` | ink | `#FFD51E` |
| Finding underlines | `--underline`; `--underline-strong` when high | `#76C0EC`; `#425B9A` when high | `#AB03A9` |
| Text selection | `--selection` | a wash of `#FF95A5` | `#5003C0` |
| The selected finding's highlight | `--accent-wash` | a wash of `#76C0EC` | `#5003C0` |
| Quote bars, rules, link underlines, the bar beside the selected palette row | `--secondary` | `#76C0EC` | `#AB03A9` |
| The unsaved mark, additions in a diff, the bar under the selected search match | `--tertiary` | `#FF95A5` | `#FF467A` |
| Search matches (§12.6) | `--match` | `#FBE7A6`, a highlighter wash | `#3D3515`, a wash of `#FFD51E` |

Body text stays in ink, a near-black navy in light and a near-white in dark.
No palette colour carries running text: the light `#76C0EC` and `#FF95A5` are
too low in contrast on the cream paper.

**Theme.** `[appearance] theme` is `light`, `dark` or `system`. The palette
command *theme* sets it, and *switch light and dark* flips what is on screen;
from `system` it moves to the opposite of what the system shows. Both are in
the View menu. Every change is saved to `config.toml`.

Severity is carried by the weight of an underline. In the light theme, a high
finding also takes `#425B9A`.

Three panes, but only one of them is ever furniture. Centre: the editor.
Right: the sidebar, notes aligned to the vertical position of the text they
refer to, Genius-style; it appears when there are findings and is otherwise not
there. `⌃⌘S` hides or shows it, the macOS key for a sidebar. Hiding the
margin leaves the underlines in the text. Two things show a hidden margin
again: entering review mode, because review mode works in the margin, and a
run storing its first findings. Left: the document list, hidden by default and summoned from the
palette.

The centre pane is the whole app. It should be pleasant to write in for an
hour, and it should look the same whether or not a model has ever run.

### 12.2 The command bar and the macOS menu

Everything that is not typing happens through a `⌘K` palette: open a document,
create one, run passes, choose a provider, flag a revision, open the duel,
toggle settings. It is a single text field with a filtered list, monochrome, no
icons.

A command that needs an argument asks for it in the same field rather than
opening a dialog.

On macOS the same commands also appear in the system menu bar, in `menu.rs`:
writegood, File, Edit, View, Review, Window, Help. A menu item emits the id of a palette
command, and the palette runs it, so the menu and the keyboard cannot drift
apart. A command that needs an argument opens the palette on that command. The
Edit submenu carries Undo, Redo, Cut, Copy, Paste and Select All: WKWebView
takes those keystrokes from the menu, and without the items the editor cannot
copy or paste. It also carries a Find submenu: Find…, Find and Replace…,
Find Next and Find Previous (§12.6). File carries New, Open…, Open Recent, Save, Save As… and Save
as major revision (§6.3). Open Recent is rebuilt by Rust and its items open a
document, not a palette command. File > Open the writegood folder is handled
in Rust, because Rust owns the filesystem. View carries Show or hide the margin (`⌃⌘S`),
Bigger text (`⌘+`), Smaller text (`⌘-`) and Actual size (`⌘0`), where macOS
apps put them, and the two theme commands.

No menu item writes model words into the document. There is nothing to write
(§2).

### 12.3 Findings in the text

Open findings get a subtle underline, weighted by severity (§12.1). The selected finding
gets a background highlight and its sidebar note expands. Stale findings are
greyed with no underline. Dismissed findings are hidden unless you turn them on.

Overlapping findings are normal. Underlines stack; the sidebar orders by
document position, then severity.

**Clicking a highlight** lights every finding at that spot, in the text and in
the margin. The first of them in document order takes the focus, so `x`, `d`
and `r` act on it and `j` / `k` step on from it. The next step lights one
finding again.

**Notes align with their highlights.** Stacking can put a note far below its
sentence. Aligning scrolls the margin until the note's top is level with its
highlight, and the notes above it scroll out past the top of the band. The
next scroll of the draft brings the margin back level with the draft.

- A click on a highlight aligns the focused note. The draft does not move.
- The caret moving into a highlight aligns its note, in writing mode and in
  review mode. Where findings overlap, the focused one aligns if the caret is
  in it, or else the first in document order. Nothing is lit, so the margin
  stays quiet while you write. The draft does not move. Typing does not align.
  A caret outside every highlight leaves the margin where it is.
- A step with `j` / `k` aligns the note. If the highlight is out of view, the
  draft first scrolls as little as it can to bring it into the band. If the
  aligned note would run past the foot of the band, the draft scrolls up
  until the note fits, but never so far that the highlight leaves the top.
- A click on a note in the margin only brings the note into view. Aligning a
  note under the mouse would move it away from the pointer.

**Drawn ranges are tidied.** Models are loose about the edges of a quote: one
includes the full stop, another stops before it, a third starts with the space
or the comma before the first word. What is drawn is tidied. The stored quote
is not changed. The rules, in `spans.ts`:

1. A range never starts or ends with whitespace, and never starts with `,`,
   `;`, `:` or `.`. Those characters are trimmed off.
2. Among overlapping ranges, two ends that differ only by closing punctuation
   (`.,;:!?` and closing quotes and brackets) move to the later one, so every
   range that reaches a sentence's end takes its full stop. Two starts that
   differ only by opening quotes and brackets move to the earlier one.
3. A range that tidying would empty is drawn as the model placed it.

### 12.4 Keyboard

The app is driven from the keyboard. The keys here are written for macOS.
On Linux and Windows, Ctrl takes the place of ⌘ (§12.7).

A bare `n` has to type an "n", so the single-letter keys live in a **review
mode**. `Esc` leaves the text and enters it; the editor dims and the margin
becomes the active pane. `Esc`, `Enter` or `i` returns to writing.

In writing mode, `Esc` is also the key that closes things, as it is across
macOS. Each press closes one thing, in this order:

1. The find bar (§12.6), wherever the focus is. The caret goes back to the
   text.
2. A selection the author made. It collapses to a caret at its end. The
   selection a focus change makes, over a finding's words, does not count,
   so `Esc` after a click on a highlight still enters review mode.
3. With neither, review mode starts.

Returning to writing unlights the focused finding, in the text and in the
margin, so nothing is lit while you write. The focus is kept, and the next
`j` / `k` steps on from it. A click on a highlight or a step with `⌥↓` /
`⌥↑` lights again while writing, and so does entering review mode.

**Unchecked paragraphs.** In review mode a grey dot in the left gutter marks
each paragraph that is not checked. A paragraph is not checked when at least
one enabled paragraph-scope pass has no saved answer for its current key
(§8.3). This is the paragraph the next run would ask about: one edited since
the last run, or the one after it. The rules:

- The markers show only in review mode. Returning to writing removes them.
- The app marks the paragraphs that are not checked, not the checked ones.
  After a run nearly every paragraph is checked, so the exception carries the
  information.
- Before the first run there are no markers. If no enabled paragraph-scope
  pass has any saved answer for the document, every paragraph would carry
  one. Entering review mode then says "no passes run yet" in the status line.
- Document-scope passes get no markers. Their one key covers the whole draft,
  so any edit unchecks every paragraph.
- The keys are the runner's own. `passKeys` in `run.ts` computes them for
  both, with the provider the session override selects.
- The markers are computed on entering review mode, and again when a run
  ends in review mode. The computation is async. A result that arrives after
  the mode or the text has changed is discarded.

The dot is 4px at the base text size, and scales with ⌘+ and ⌘-. It sits
where the top of the focus bar would sit, level with the paragraph's first
line. It has no text, no hover and no click. Its colour is `--ink-faint`,
the grey of the status bar. The accent means "you are here", and the
tertiary colour means "unsaved", so neither fits.

Always available:

| Key | Action |
|---|---|
| `⌘K` | the command bar |
| `⌘N` | new untitled document (§6.3) |
| `⌘O` | open a file, through the native open dialog |
| `⌘R` or `⌘⏎` | run the enabled passes |
| `⌘⇧R` or `⌘⇧⏎` | run one pass (the bar asks which) |
| `⌘S` | save; on an untitled draft, the native save dialog |
| `⌘⇧S` | save as, through the native save dialog |
| `⌘⌥S` | save and flag a major revision (the bar asks what changed) |
| `⌘D` | duel: rewrite the current paragraph |
| `⌘Y` | revisions |
| `⌃⌘S` | hide or show the margin (§12.1) |
| `⌘+` / `⌘-` | bigger / smaller text, saved to the config |
| `⌘0` | text back to the base size, saved to the config |
| `⌥↓` / `⌥↑` | next / previous finding, without leaving the text |
| `⌘F` / `⌥⌘F` | find; find and replace (§12.6) |
| `⌘G` / `⌘⇧G` | next / previous match |
| `⌘?` | help |
| `Esc` | close the find bar, then clear the selection, then review mode |

In review mode:

| Key | Action |
|---|---|
| `n` / `j` | next finding |
| `p` / `k` | previous finding |
| `x` | mark the selected finding addressed |
| `d` | dismiss it |
| `r` | reveal a withheld span |
| `i` / `Enter` / `Esc` | back to writing |

Findings navigation must work without the mouse, including scroll sync. That is
the "tick forward and back through suggestions" requirement, and it is the
difference between using the tool and abandoning it.

On macOS the menu bar shows these keys (§12.2). A menu item holds one
shortcut, so the Review menu shows `⌘R` and `⌘⇧R`, and the window's own key
handler takes `⌘⏎` and `⌘⇧⏎`. Both keys run the same palette command. One
command, one code path.

`⌘R` was added beside `⌘⏎` so the end-to-end tests can press it. The WebDriver
plugin drops ⌘ from Enter but not from letters (§16.1). `⌘⏎` stays because it
is the key the author uses.

It is not known which sees a ⌘ key first on macOS, the page or the menu bar.
The app works in either order. While the duel or the revisions sheet is open,
a menu command goes to the sheet, not to the palette: `Run all passes` asks
the judge in the duel and does nothing in the revisions sheet. Text size is
the exception: `⌘+`, `⌘-` and `⌘0` work over either sheet, from the keyboard
and from the menu.

The duel and the revisions sheet cover the window and take the keyboard while
they are open: `Esc` closes, `⌘R` or `⌘⏎` asks the judge, `j` / `k` move between
revisions, `Enter` puts a revision back.

**Help.** `⌘?`, Help > writegood help, or *help* in the command bar opens a
help page. The page is a Markdown document, `src/lib/help/help.md`, shown in a
second, read-only editor so it reads like a draft. It covers the window like
the sheets and takes the keyboard the same way. `Esc` or `⌘?` closes it. The
draft stays mounted under it and is read-only while the help is open, so its
text, selection, undo history, scroll and unsaved changes are all kept.

### 12.5 States that need designing

Empty document. Pass running, no findings yet. Pass returned nothing — say so
plainly, "no findings", not "looks good". Pass failed. Provider key missing.
Every finding stale after a heavy rewrite.

Note the second-to-last: the empty result must not become a compliment.

### 12.6 Find and replace

`⌘F` opens a find bar at the top of the editor pane. `⌥⌘F` opens it with a
second field for the replacement. The bar belongs to writing: `Esc` closes it
before review mode can start, and entering review mode by any other path hides
it and clears its highlights.

**The bar.** One line: a *find* label, the field and a count. With replace,
a second line holds a *replace* label and its field. The fields use the
palette's type and the same rule under what you type. There are no buttons
and no option toggles. Every action is a key.

**Matching.** The search is literal text within one paragraph, from
`prosemirror-search`. It ignores case unless the query holds a capital
letter. Matches are highlighted as you type, and the first match at or after
the caret is selected. The count reads "3 of 12", "12 matches" when the
selection is on none of them, or "no matches".

**Keys.**

| Key | Where | Action |
|---|---|---|
| `⌘F` | anywhere | open the bar and select the find field |
| `⌥⌘F` | anywhere | open the bar with the replace field |
| `⌘G` / `⌘⇧G` | anywhere | next / previous match |
| `Enter` / `⇧Enter` | find field | next / previous match |
| `Enter` | replace field | replace this match and select the next |
| `⌥Enter` | replace field | replace every match |
| `Tab` | the bar | move between the fields |
| `Esc` | anywhere | close the bar; the caret goes back to the text |

`Esc` closes the bar before it does anything else (§12.4). Review mode cannot
start with the bar open, and anything that enters it hides the bar. `⌘F` in
review mode returns to writing and opens the bar. `⌘G` with the bar closed
opens it on the last query. The query and the replacement are kept for the
session and are not saved.

**Colour.** Every match takes `--match`, a wash under the words. The selected
match adds a bar under the words in `--tertiary`. Both differ from the
finding underlines and the selected finding's wash, so a match on a finding
reads as both.

**The rest of the app.** A replacement is one edit, so `⌘Z` undoes it. Replace
all is one edit too. The findings move with the text and re-anchor as they do
for typing (§7). A finding on the replaced words goes stale.

The replace field holds only what the author types. Nothing fills it from a
finding, a note or a model reply (§2).

The palette has *find*, *find and replace*, *find next*, *find previous* and
*replace all*. The Edit menu has a Find submenu with the first four.

### 12.7 Hints and shortcuts on each platform

**Hints.** The status bar shows the use of the app one step at a time. Each
hint is one sentence that names one action and its key. It sits at the left
of the status bar, after the review mark and the cost. The steps, in order:

| Step | Hint (macOS) | Shows when |
|---|---|---|
| `palette` | Press ⌘K to open the command bar. | always |
| `run` | Press ⌘R to run the passes. | a document is open |
| `select` | Press ⌥↓ to go to the next finding. | there are findings |
| `review` | Press Esc to enter review mode. | a finding is focused, writing mode |
| `mark` | Press d to dismiss the finding, or x to mark it addressed. | a finding is focused, review mode |
| `move` | Press j for the next finding and k for the previous. | there are findings, review mode |
| `write` | Press i to go back to writing. | review mode |
| `history` | Press ⌘Y to see the revisions. | a document is open, writing mode |
| `duel` | Press ⌘D to duel the paragraph under the cursor. | a document is open, writing mode |
| `find` | Press ⌘F to find text. | a document is open, writing mode |
| `help` | Press ⌘? to open the help. | writing mode |

The rules, in `hints.ts`:

- The app records an action the first time the author takes it, by any
  route: the key, the command bar or the menu. The record is made where the
  action runs, not where the key is read. Opening the command bar counts
  however it opens. `select` is any focus change: a step, a click on a
  highlight, a click on a note. `move` is `j`, `k`, `n` or `p` in review
  mode. `write` is any return to writing.
- The hint is the first step whose action is not recorded. An action taken
  early is recorded, and its step is skipped when its turn comes. It does
  not skip the steps before it.
- When the first step's action cannot work in the window as it stands, no
  hint shows. A later step never shows in its place. For example, `select`
  waits for a run that finds something.
- When every action is recorded, no hint shows.

The records are the `actions` table (§6.2): one row per action, with the
time of the first. Rust writes them through `action_record` and reads them
through `actions_list`. The frontend loads the list at boot and records each
action once. The list belongs to the author, not to a document, so a new
document does not start the hints again.

**Shortcuts on each platform.** Every binding uses the platform's primary
modifier: ⌘ on macOS, Ctrl on Linux and Windows. The window's key handler
reads it through `isMod` in `shortcuts.ts`, so Ctrl on macOS stays with the
text field. The editor's own keys use TipTap's `Mod-`. The macOS menu uses
`CmdOrCtrl`.

A shortcut is written once, as a spec in ProseMirror's notation: `Mod-k`,
`Alt-Mod-f`, `Ctrl-Meta-s`. `Mod` is the primary modifier. `Meta` is ⌘, the
Windows key or Super. `shortcut()` turns a spec into the label for the
platform. macOS gets symbols in the spec's order: `⌘⇧R`. Linux and Windows
get words joined by `+`, in the order Ctrl, Alt, Shift, then the Windows key
or Super: `Ctrl+Shift+R`. A letter with a modifier is upper case. A bare
letter keeps its case, because upper case would mean ⇧. Every label the app
shows comes from `shortcut()`: the hints, the command bar and the duel. The
help page is written with macOS labels, and the app rewrites the shortcuts in
its code spans for Linux and Windows.

The platform comes from the webview's navigator: `userAgentData.platform`
where it exists, else `navigator.platform`. No plugin is needed. `?os=linux` or `?os=windows` overrides it, so
the browser fixture can show another platform's labels. `?done=palette,run`
in the browser fixture marks actions as taken.

---

## 13. Files on disk

```
~/.writegood/
├── config.toml           providers, rules, appearance
├── writegood.db          revisions, findings, runs, duels
├── prices.json           model prices from models.dev, refreshed weekly (§9.4)
├── documents/            where the dialogs start; drafts can live anywhere
│   └── on-writing.md
├── untitled/             recovery files for drafts not yet saved (§6.3)
└── passes/               your prompts, Markdown, one per file
    ├── 01-nominalization.md
    └── ...
```

Everything except the database is plain text you can edit, diff and version.
The database holds history and findings only, and the app works without it.

---

## 14. Build order

1. ~~**Bones.** Tauri shell, Svelte, TipTap, SQLite, documents and revisions.~~
2. ~~**Anchoring.** `anchors.rs`, the position map, the decoration plugin.~~
3. ~~**One pass, one provider.**~~
4. ~~**The pass library.** Config loading, the starter prompts, fan-out.~~
5. ~~**Providers.** The `genai` backend and the CLI runner.~~
6. ~~**Revisions.** History sheet, major flags, word-level diff.~~
7. ~~**The duel.**~~

All seven are built. What is left is not a next step but a list: see 15.

The original note said steps 1 and 2 were the risk, and that was wrong.
Anchoring worked from its first test suite. The risk was the provider layer,
where the same code silently returned nothing on one vendor and worked on
another (8.3).

---

## 15. Open questions

- **Paragraph-scope context.** Sending the whole draft with every paragraph call
  is the accurate option and the expensive one. Prompt caching makes it cheap on
  the API backend and does nothing for the CLI backend. Measure before deciding.
- **Sidebar collision.** Many findings on adjacent lines will fight for vertical
  space. Genius solves this by stacking and offsetting. Needs a layout pass.
- **Does the redaction guard annoy more than it protects?** Unknown until it is
  used on real notes. Instrument how often spans are revealed.
- **Passes are slow.** `deepseek-flash` takes about a minute per call, and a
  paragraph-scope pass makes one call per paragraph. Nine passes over a real
  piece is a coffee break. Worth measuring against a faster vendor, and worth
  reconsidering whether paragraph scope should batch several paragraphs.
- **`allow_suggestions = true` is accepted but does nothing.** The preamble
  drops its no-suggestions clause; the schema has no field to hold a
  replacement and there is no apply action. Finishing it means a second schema.
- **The judge is not sampled.** One verdict decides a duel. Three calls with
  the sides shuffled each time would be a better signal, at three times the
  cost.
- **Diff granularity in revision history.** Word-level diff is more useful than
  line-level for prose, and more work. Probably `similar` in Rust.
- **Jev: method `across` is not built.** Measured with the rule text alone,
  it scored 72.7% on sentence openings, below DeepSeek's 78.8% mean with the
  same rule (§8.4). It stays specified in case a later version of Jev or of
  the rule changes that.
- **Jev: severity is confidence.** It comes from the Noul probability, not
  from the severity bands in the rule. A Choice over the three severities,
  with the rule text as the criterion, would let the rule decide. It is not
  measured.
- **Jev: answers vary between runs.** Two runs per setting cannot separate a
  gain of a few points from noise. For missing actor, the gain over one
  Noul per sentence was smaller than the spread between runs.
- **Jev: nominalization and missing actor.** Method `sentence` is not
  measured for nominalization. For missing actor it dropped the short
  subject from four of seven quotes. Both stay on the language model until
  a run shows otherwise.
- **Jev: languages other than English.** Only one Spanish draft was
  measured, with one Noul per sentence. Method `sentence` and method
  `across` are not measured outside English.
- **Jev: a long paragraph.** A request can pass the 64,000-token limit when
  a paragraph has many sentences, because each Noul carries the paragraph.
  Splitting the detect request would avoid that. On the 5,000-word chapter
  the largest request used 8,661 tokens.

---

## 16. Driving the real app

The browser fixture (`bun run browser`) shows the interface in Chrome with fake
data. It cannot show the real WebKit view, the real Rust core or the real
database. This section adds a way to drive the real app from a script, for two
uses: end-to-end tests, and looking at a running dev build while debugging.

### 16.1 Mechanism

Debug builds carry a W3C WebDriver server inside the app:
`tauri-plugin-wdio-webdriver`, registered in `lib.rs` under
`#[cfg(debug_assertions)]`. It listens on `127.0.0.1` only. The port comes from
`TAURI_WEBDRIVER_PORT` and defaults to 4445. A release build does not register
the plugin, so the `.app` has no server.

The client is `webdriverio`, called as a library with `remote()` from Bun. The
WDIO test runner, `@wdio/tauri-service`, Mocha and Node are not used. The
service was tried: it needs Node, it adds a second plugin, a frontend import
and `withGlobalTauri`, and without them it waits 5 seconds before every element
command. Plain `remote()` against the plugin needs none of that. It ran the
trial's three checks in under 2 seconds.

What the driver can do: find elements, read the DOM, run JavaScript in the
page, click, type, send keys, and take a screenshot of the page.

What it cannot do, on macOS:

- **Native input.** Keys and clicks arrive as DOM events made in JavaScript.
  The native menu bar never sees them, so a menu shortcut such as `⌘R`
  reaches the webview's own key handler, not the menu. The menu stays a
  manual check.
- **The clipboard.** A synthetic `⌘C` or `⌘V` does not reach WebKit's copy and
  paste commands. Copy and paste stay a manual check.
- **A modifier on a named key.** The plugin sets `metaKey`, `ctrlKey`,
  `altKey` and `shiftKey` only on letters and digits. `⌘S` and `⌘K` arrive
  with ⌘ held; `⌘⏎`, `⌥↓` and `⌘⇧⏎` arrive as bare Enter and ArrowDown. This
  is a defect in 1.4.0 and on its main branch as of 23 September 2026. Tests
  press `⌘R`, which the app accepts beside `⌘⏎` for this reason (§12.4).
- **Typing into ProseMirror with `keys()`.** Key events insert no text in a
  contenteditable. `addValue()` on the editor element works, because the
  plugin inserts text with `execCommand("insertText")`.
- **Placing the caret with a click.** A synthetic click does not move the
  caret. Tests set the DOM selection first, which ProseMirror follows, and
  then type.
- **Clicking an element.** An element click sends one `click` event at 0,0
  and no `mousedown`. ProseMirror acts on `mousedown`, so a click on a
  highlight does nothing. Pointer actions at coordinates send all three
  events, and the tests click that way.
- **The window frame.** A screenshot is the page only.

### 16.2 End-to-end tests

`e2e/*.e2e.ts`, run with `bun run e2e`. The script builds a debug binary with
the frontend embedded (`tauri build --debug --no-bundle`) into its own target
directory, `src-tauri/target/e2e`, so it does not force `tauri dev` to rebuild.
Then it runs the tests with `bun test`. `bun test src/lib` does not pick them
up, because the file names do not match its pattern.

Each test file launches its own copy of the app with:

- **A fresh home.** A new temporary `WRITEGOOD_HOME` holds a config, a fixture
  document, one test pass and a `prices.json` dated now. The real
  `~/.writegood` is never read or written. No `.env` is copied in.
- **Its own port.** A free port is chosen for `TAURI_WEBDRIVER_PORT`, so a test
  never connects to a dev build that is already running on 4445.
- **No focus.** `WRITEGOOD_BACKGROUND` makes a debug build launch under the
  Prohibited activation policy, which macOS cannot activate, and switch to
  Accessory once the window exists. The window has no Dock icon and never
  takes the focus. It floats above the author's windows: WebKit treats a
  covered page as hidden and stops animation frames, and TipTap focuses the
  editor in one. WebKit's private `_setWindowOcclusionDetectionEnabled:` was
  tried and did not keep a covered page visible.
- **A fake model.** The test process serves an OpenAI-compatible endpoint on
  `127.0.0.1`. The config points an `openai-compatible` provider at it, so a
  pass goes through the real Rust client, `genai`, the usage count and the
  price lookup. The fake returns fixed findings for the test pass, an empty
  array for every other pass, and a verdict for the judge. It reports token
  counts, and `prices.json` has a rate for it, so the cost label can be
  checked. Nothing leaves the machine and no key is needed.

The first set of tests covers:

- **Editor.** The fixture opens. Typed text reaches the editor, and a save
  writes it to the Markdown file on disk.
- **Review.** Running the passes puts one note in the margin per finding, and
  each highlight covers exactly its quoted words. `Esc` then `j` moves the
  focus. The focused note is in view. `x` marks a finding addressed.
- **Cost.** After a run, the status bar shows the cost that the fake model's
  token counts and rates give.
- **Rerun.** A second run replaces the first run's notes, so the margin holds
  one note per finding. `⌃⌘S` hides the margin and leaves the underlines.
  `⌃⌘S` shows it again, and so does entering review mode.
- **Unchecked paragraphs.** Before a run, review mode shows no markers and
  says "no passes run yet". After a run it shows none. An edit to one
  paragraph marks that paragraph and the one after it. Returning to writing
  removes the markers.
- **Duel.** `⌘D` opens the duel. A typed rewrite goes to the judge on `⌘R`,
  and the result names the version the judge picked, whichever side the
  shuffle put it on.
- **Jev.** The test process also serves a fake Jev, and the home gets a
  `jev` provider and a pass written for it. A run puts one note per chosen
  span in the margin, with the pass's note and the draft's own words. Each
  request carries the paragraph and the rule text. The cost comes from the
  provider's `price`, because no catalog lists the fake. A rerun with no
  edits asks Jev nothing. When the fake answers HTTP 503 for one paragraph,
  only that paragraph goes without notes, the pass does not fail, and the
  next run asks Jev about that paragraph alone.

A test fails with the app's own log attached, read from the test home.

### 16.3 Driving a dev build

`bun run app` is a debug build, so the server runs there too, on port 4445.
`bun dev/drive.ts` connects to it and does one thing per call:

```
bun dev/drive.ts shot [file]          screenshot of the page (default /tmp/writegood.png)
bun dev/drive.ts text [selector]      the text of an element (default the editor)
bun dev/drive.ts html [selector]      the outer HTML of an element
bun dev/drive.ts eval '<js>'          run JavaScript in the page, print the result
bun dev/drive.ts click <selector>     click the middle of an element
bun dev/drive.ts keys <key>...        send keys, e.g. Escape j j
bun dev/drive.ts type '<text>'        insert text in the editor at the cursor
```

`keys` takes WebDriver key names: `Escape`, `Enter`, `ArrowDown`, `Command`.
A modifier reaches letters only (§16.1). `TAURI_WEBDRIVER_PORT` overrides the
port. Each call opens a WebDriver session
and closes it after. Closing a session does not close the window.

A dev build reads and writes the real `~/.writegood`. `click`, `keys` and
`type` change whatever file is open, and the app saves it. To drive edits
safely, start the dev build with `WRITEGOOD_HOME` set to a scratch directory.

The server also lets any local process run JavaScript in the page, and through
it call any Tauri command. That is acceptable for a debug build on
`127.0.0.1`. It is the reason the plugin is never registered in a release
build.
