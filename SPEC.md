# writegood — specification

Status: draft 1, 21 September 2026. Nothing is built yet.

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
```

The last row was checked on 23 September 2026. Both are for driving the app
in tests and in dev (§16). `webdriverio` is a dev dependency, and a release
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
│   │   ├── palette/Palette.svelte  the only chrome (§12.2)
│   │   ├── editor/
│   │   │   ├── Editor.svelte     TipTap instance
│   │   │   └── findings.ts       decoration plugin for highlights
│   │   ├── sidebar/
│   │   │   ├── Sidebar.svelte    Genius-style margin notes
│   │   │   └── redact.ts         Rule One guard (§10.3)
│   │   ├── passes/
│   │   │   ├── run.ts            orchestration, fan-out, progress
│   │   │   └── schema.ts         Zod finding schema + system preamble
│   │   └── providers/index.ts   resolve a provider name (the call is Rust's)
│   │   └── duel/Duel.svelte      A/B compare UI
└── src-tauri/                    Rust
    └── src/
        ├── lib.rs                builder, command registration
        ├── error.rs              AppError → serialisable strings
        ├── db.rs                 schema, CRUD, transactions
        ├── anchors.rs            re-anchoring (§7)
        ├── config.rs             ~/.writegood config, rules, passes
        ├── llm.rs                provider calls via genai (§9.2)
        ├── log.rs                ~/.writegood/writegood.log
        ├── menu.rs               the macOS menu bar (§12.2)
        ├── documents.rs          Markdown files on disk (§6.1)
        ├── runner.rs             CLI subprocess with timeout
        └── secrets.rs            macOS keychain via `keyring`
```

**Boundary rule.** Rust owns durable state, the filesystem, subprocesses,
string matching and every network call. TypeScript owns the editor,
orchestration, prompt building, parsing and position mapping. Neither reaches
across.

---

## 6. Data model

### 6.1 Markdown is the source of truth

A draft is a Markdown file on disk. `~/.writegood/documents/*.md` by default,
or any path you open. The app reads and writes that file and nothing else owns
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
documents(id, path, title, created_at, updated_at)

revisions(id, doc_id→documents, parent_id→revisions,
          content_json, content_text, major, label, created_at)

runs(id, doc_id, revision_id, pass_slug, pass_name,
     provider, model, status, error, started_at, finished_at,
     input_tokens, output_tokens, cost_usd)

findings(id, run_id→runs, doc_id, category, severity, note,
         quote, prefix, suffix, status, created_at)

duels(id, doc_id, finding_id→findings, a_text, b_text, a_is_original,
      judge_provider, judge_model, verdict, original_won, reason, created_at,
      input_tokens, output_tokens, cost_usd)
```

`documents.path` is absolute and unique. The row is a pointer and a cache of
the title; the file is the document.

`content_json` is the ProseMirror document, kept so a revision restores exactly.
`content_text` is the flattened text that anchoring and passes work against.

**Revision policy.** Consecutive ordinary saves collapse into the newest row, so
typing does not bury the revisions you marked. Marking a revision major starts a
new row and freezes the previous one. `label` is your note on why it is major.

`findings.status` is one of `open`, `addressed`, `dismissed`, `stale`. Nothing
is ever deleted by the app; `stale` is set by anchoring, not by you.

`duels.original_won` is derived at write time from `verdict` and
`a_is_original`, so the A/B shuffle never has to be unpicked later.

The three usage columns on `runs` and `duels` are nullable (§9.4). A CLI call
reports no tokens, so both counts are null. A call with no known price has
tokens and a null cost. A database made before these columns existed gains
them at startup; the rows it already holds stay null.

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

### 8.2 Starter set

Ship a starter set, clearly marked as a starting point to be replaced. Derived
from *Style: Lessons in Clarity and Grace*, which Ptacek names as the source
worth stealing from:

`nominalization`, `passive-actor`, `sentence-openings`, `filler-words`
(very / really / actually / unfortunately), `repeated-phrasing`,
`paragraph-order`, `topic-flow`, `unearned-metaphor`, `length` (which 750 words
are doing no work).

### 8.3 Running

The runner fans out across enabled passes with a small worker pool. A pass that
fails marks its run `error`, keeps whatever arrived before the failure, and
leaves the other passes alone.

Findings arrive one pass at a time rather than one finding at a time. Both
backends end at the same place — a block of text that should contain a JSON
array — and `parse.ts` reads it. Per-element structured-output streaming does
not survive provider switching: an endpoint without structured-output support
returns a bare array where the caller expects a wrapper, and the result is
silently zero findings. One code path with one failure mode is worth more here
than per-element streaming.

An item that fails the schema is dropped, so one malformed entry does not
discard the nine good ones beside it. If *every* item fails and there was at
least one, the pass throws instead: a provider that has changed its field names
must not read as a clean nothing-found. A genuinely empty array stays silent,
because finding nothing is a normal result.

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

---

## 9. Providers

### 9.1 Configuration

`~/.writegood/config.toml`. Editable by hand; the palette opens it.

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
timeout_secs = 180
```

`[rules]` is the one place the two rules can be relaxed (§2). Turning
`allow_suggestions` on changes the finding schema and adds an apply action;
everything else in the app is unaffected. `blind_judge = false` lets the judge
share a vendor with the pass, which makes the duel results worth less.

`[appearance]` is read at startup and on file change. `font` accepts any
family installed locally, or the `ui-serif` / `ui-sans-serif` / `ui-monospace`
keywords.

`kind` selects the backend. Anything with an API key goes through `genai` in
`llm.rs` (§9.2); `cli` shells out. A pass names a provider or inherits `default_provider`. The header
bar also has a provider override for the current session, which wins over both.

### 9.2 Network backend

`genai`, in `llm.rs`. It is the nearest Rust equivalent of the AI SDK's core:
one call shape across Anthropic, OpenAI, Gemini, DeepSeek, Ollama, OpenRouter
and the rest, with a `ServiceTargetResolver` for anything else. A provider's
`kind` chooses the adapter, `base_url` overrides the endpoint for the
`openai-compatible` kind, and `key_ref` supplies the key. `tokio::time::timeout`
enforces `timeout_secs`.

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
that has never loaded, shows tokens and no money.

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

**Type.** Literata, bundled as a variable font in four woff2 subsets, about
390 KB. It is a modern reading serif — softer and rounder than a bookface,
drawn for screens, with optical sizing. Set at 18px on a 1.66 line, a fixed
measure of about 68 characters, and generous margins. `ui-serif` and Georgia
follow it in the stack, and `[appearance] font` overrides the whole thing.
Bundled rather than fetched, because the app must work with no network.

**Colour is rationed.** Paper and ink carry everything, with one grey for
anything secondary. There is exactly one accent: a muted vermilion, the red of
a hanko seal. It means "you are here" and nothing else — the selected finding,
the selected revision, additions in a diff, the duel's verdict, and the two
states worth a glance from across the room, *working* and *unsaved*.

Severity is still carried by the weight of an underline, never by hue. Nothing
in the text competes with the text.

Three panes, but only one of them is ever furniture. Centre: the editor.
Right: the sidebar, notes aligned to the vertical position of the text they
refer to, Genius-style; it appears when there are findings and is otherwise not
there. Left: the document list, hidden by default and summoned from the
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
writegood, File, Edit, Review, Window. A menu item emits the id of a palette
command, and the palette runs it, so the menu and the keyboard cannot drift
apart. A command that needs an argument opens the palette on that command. The
Edit submenu carries Undo, Redo, Cut, Copy, Paste and Select All: WKWebView
takes those keystrokes from the menu, and without the items the editor cannot
copy or paste. File > Open the writegood folder is handled in Rust, because
Rust owns the filesystem.

No menu item writes model words into the document. There is nothing to write
(§2).

### 12.3 Findings in the text

Open findings get a subtle underline, coloured by severity. The selected finding
gets a background highlight and its sidebar note expands. Stale findings are
greyed with no underline. Dismissed findings are hidden unless you turn them on.

Overlapping findings are normal. Underlines stack; the sidebar orders by
document position, then severity.

**Clicking a highlight** lights every finding at that spot, in the text and in
the margin. The first of them in document order takes the focus, so `x`, `d`
and `r` act on it and `j` / `k` step on from it. The next step lights one
finding again.

A click in the text also scrolls the margin until the focused note's top is
level with the highlight that was clicked. The draft does not move. Stacking
can put a note far below its sentence. This brings it back beside the words
the reader is looking at, and the notes above it scroll out past the top of
the band. The next scroll of the draft brings the margin back level with it.
Stepping with `j` / `k`, and clicking a note in the margin, only bring the note
into view. Aligning a note under the mouse would move it away from the
pointer.

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

The app is driven from the keyboard.

A bare `n` has to type an "n", so the single-letter keys live in a **review
mode**. `Esc` leaves the text and enters it; the editor dims and the margin
becomes the active pane. `Esc`, `Enter` or `i` returns to writing.

Always available:

| Key | Action |
|---|---|
| `⌘K` | the command bar |
| `⌘N` | new document (the bar asks for a title) |
| `⌘O` | open a document (the same bar, pre-filtered) |
| `⌘R` or `⌘⏎` | run the enabled passes |
| `⌘⇧R` or `⌘⇧⏎` | run one pass (the bar asks which) |
| `⌘S` | save |
| `⌘⇧S` | save and flag a major revision (the bar asks what changed) |
| `⌘D` | duel: rewrite the current paragraph |
| `⌘Y` | revisions |
| `⌥↓` / `⌥↑` | next / previous finding, without leaving the text |
| `Esc` | review mode |

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
the judge in the duel and does nothing in the revisions sheet.

The duel and the revisions sheet cover the window and take the keyboard while
they are open: `Esc` closes, `⌘R` or `⌘⏎` asks the judge, `j` / `k` move between
revisions, `Enter` puts a revision back.

### 12.5 States that need designing

Empty document. Pass running, no findings yet. Pass returned nothing — say so
plainly, "no findings", not "looks good". Pass failed. Provider key missing.
Every finding stale after a heavy rewrite.

Note the second-to-last: the empty result must not become a compliment.

---

## 13. Files on disk

```
~/.writegood/
├── config.toml           providers, rules, appearance
├── writegood.db          revisions, findings, runs, duels
├── prices.json           model prices from models.dev, refreshed weekly (§9.4)
├── documents/            your drafts, Markdown, one per file
│   └── on-writing.md
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
- **Duel.** `⌘D` opens the duel. A typed rewrite goes to the judge on `⌘R`,
  and the result names the version the judge picked, whichever side the
  shuffle put it on.

A test fails with the app's own log attached, read from the test home.

### 16.3 Driving a dev build

`bun run app` is a debug build, so the server runs there too, on port 4445.
`bun dev/drive.ts` connects to it and does one thing per call:

```
bun dev/drive.ts shot [file]          screenshot of the page (default /tmp/writegood.png)
bun dev/drive.ts text [selector]      the text of an element (default the editor)
bun dev/drive.ts html [selector]      the outer HTML of an element
bun dev/drive.ts eval '<js>'          run JavaScript in the page, print the result
bun dev/drive.ts click <selector>     click an element
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
