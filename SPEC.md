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
| Providers | Vercel AI SDK v7, plus a CLI subprocess backend |
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
@tauri-apps/plugin-http 2.6.1      tauri-plugin-http   2.7.0
ai                     7.0.108     rusqlite            0.40.2
@ai-sdk/anthropic      4.0.58      strsim              0.11.1
@ai-sdk/openai         4.0.72      keyring             4.2.0
@ai-sdk/google         4.0.76      toml                1.1.6
@ai-sdk/openai-compatible 3.0.53
zod                    4.6.5
svelte                 5.57.1
@tiptap/core           3.31.3
vite                   8.3.0
prosemirror-markdown   1.13.4
markdown-it            14.1.0
```

Two notes. The AI SDK is at v7, not v6 — `streamObject` still exists but the
current API is `streamText` with `Output.array({ element })`. The app does not
use it — see 8.3 for why provider switching rules it out — and reads the reply
text itself instead. And
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
│   │   ├── providers/
│   │   │   ├── index.ts          resolve a provider name → callable
│   │   │   ├── api.ts            AI SDK backend
│   │   │   └── cli.ts            subprocess backend (calls Rust)
│   │   └── duel/Duel.svelte      A/B compare UI
└── src-tauri/                    Rust
    └── src/
        ├── lib.rs                builder, command registration
        ├── error.rs              AppError → serialisable strings
        ├── db.rs                 schema, CRUD, transactions
        ├── anchors.rs            re-anchoring (§7)
        ├── config.rs             ~/.writegood config, rules, passes
        ├── documents.rs          Markdown files on disk (§6.1)
        ├── runner.rs             CLI subprocess with timeout
        └── secrets.rs            macOS keychain via `keyring`
```

**Boundary rule.** Rust owns durable state, the filesystem, subprocesses and
string matching. TypeScript owns the editor, the model calls, and position
mapping. Neither reaches across.

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
     provider, model, status, error, started_at, finished_at)

findings(id, run_id→runs, doc_id, category, severity, note,
         quote, prefix, suffix, status, created_at)

duels(id, doc_id, finding_id→findings, a_text, b_text, a_is_original,
      judge_provider, judge_model, verdict, original_won, reason, created_at)
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
array — and `parse.ts` reads it. The AI SDK's `Output.array` streams per
element and does not survive provider switching: an endpoint without
structured-output support returns a bare array where the SDK expects a wrapper,
and the result is silently zero findings. One code path with one failure mode
is worth more here than per-element streaming.

An item that fails the schema is dropped. One malformed entry must not discard
the nine good ones beside it.

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

`kind` selects the backend. Anything with an API key uses the AI SDK; `cli`
shells out. A pass names a provider or inherits `default_provider`. The header
bar also has a provider override for the current session, which wins over both.

### 9.2 API backend

AI SDK v7, used to reach the provider and return text. `createAnthropic`,
`createOpenAI`, `createGoogleGenerativeAI`, and `createOpenAICompatible` for
DeepSeek, OpenRouter, Ollama and LM Studio. Every provider is
constructed with `fetch` from `@tauri-apps/plugin-http`, so requests go through
Rust's HTTP client and CORS never applies.

Keys live in the macOS keychain via the `keyring` crate, read on demand through
a Rust command. `env:` refs are also accepted for keys you already export.

Cost is not a constraint. A 2,000-word draft is roughly 2,700 tokens. Twelve
passes is about 36k input and 18k output tokens — under a dollar at
`claude-opus-5` rates ($5 / $25 per million), less with prompt caching, since
every pass sends the same draft.

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

---

## 10. The findings contract

### 10.1 Schema

```ts
const Finding = z.object({
  quote:    z.string().describe("Exact text from the draft, copied verbatim, 3-200 characters."),
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

Monochrome, classic, text first. The reference points are iA Writer and
Japanese minimalism: nothing on screen that is not text or a response to text.
Black on off-white, one grey for anything secondary, no colour except a single
hairline accent for the selected finding. No icons, no toolbar, no menu bar, no
buttons where a keystroke will do.

A serif face by default — `ui-serif`, which is New York on macOS — set large,
with a fixed measure of about 68 characters and generous margins. The typeface
is configurable in `config.toml`.

Three panes, but only one of them is ever furniture. Centre: the editor.
Right: the sidebar, notes aligned to the vertical position of the text they
refer to, Genius-style; it appears when there are findings and is otherwise not
there. Left: the document list, hidden by default and summoned from the
palette.

The centre pane is the whole app. It should be pleasant to write in for an
hour, and it should look the same whether or not a model has ever run.

### 12.2 The command bar

There are no menus. Everything that is not typing happens through a `⌘K`
palette: open a document, create one, run passes, choose a provider, flag a
revision, open the duel, toggle settings. It is a single text field with a
filtered list, monochrome, no icons.

A command that needs an argument asks for it in the same field rather than
opening a dialog.

### 12.3 Findings in the text

Open findings get a subtle underline, coloured by severity. The selected finding
gets a background highlight and its sidebar note expands. Stale findings are
greyed with no underline. Dismissed findings are hidden unless you turn them on.

Overlapping findings are normal. Underlines stack; the sidebar orders by
document position, then severity.

### 12.4 Keyboard

The app is driven from the keyboard.

| Key | Action |
|---|---|
| `n` / `p` | next / previous finding, scrolling both panes |
| `j` / `k` | same, without leaving the sidebar |
| `x` | mark the selected finding addressed |
| `d` | dismiss it |
| `r` | reveal a redacted span |
| `⌘⏎` | run the enabled passes |
| `⌘⇧⏎` | run one pass, chosen from a palette |
| `⌘S` | save a revision |
| `⌘⇧S` | save and flag as a major revision |
| `⌘D` | open the duel on the current paragraph |
| `⌘K` | command palette |
| `Esc` | back to the editor |

Findings navigation must work without the mouse, including scroll sync. That is
the "tick forward and back through suggestions" requirement, and it is the
difference between using the tool and abandoning it.

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

1. **Bones.** Tauri shell, Svelte, TipTap, SQLite, documents and revisions.
   Write and save, nothing else. Verify it is pleasant to type in.
2. **Anchoring.** `anchors.rs` with its test suite, the position map, and the
   decoration plugin. Prove a finding survives an edit before any model is
   involved, using fixtures.
3. **One pass, one provider.** Anthropic through the AI SDK, one hard-coded
   prompt, findings into the sidebar, keyboard navigation.
4. **The pass library.** Config loading, the starter prompts, fan-out, progress.
5. **Providers.** The rest of the AI SDK backends, then the CLI runner.
6. **Revisions.** History view, major flags, diff between revisions.
7. **The duel.**

Steps 1 and 2 are the risk. If anchoring does not feel solid, nothing built on
top of it will.

---

## 15. Open questions

- **Paragraph-scope context.** Sending the whole draft with every paragraph call
  is the accurate option and the expensive one. Prompt caching makes it cheap on
  the API backend and does nothing for the CLI backend. Measure before deciding.
- **Sidebar collision.** Many findings on adjacent lines will fight for vertical
  space. Genius solves this by stacking and offsetting. Needs a layout pass.
- **Does the redaction guard annoy more than it protects?** Unknown until it is
  used on real notes. Instrument how often spans are revealed.
- **Diff granularity in revision history.** Word-level diff is more useful than
  line-level for prose, and more work. Probably `similar` in Rust.
