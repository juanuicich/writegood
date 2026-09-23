# Notes on a writing tool

A local desktop app for workshopping your own prose. You write a draft in it. You run editing passes over the draft. Each pass is a prompt you wrote yourself. The app shows you what the model found, anchored to the text it found it in. You do the rewriting.

The shape comes from Thomas Ptacek's *How To Write With An LLM* (sockpuppet.org, 17 September 2026) and the opening prompt he used to build his own version:

This spec keeps his feature list and his two rules. It changes the stack, and it makes the two rules structural rather than advisory.

Ptacek's rules are about discipline. A tool can enforce them instead.

**Rule One: you may not use a single word the model suggests.**

The app never inserts text into your document. There is no Accept button and no apply action. A finding is a location plus a description of a problem. The schema the model fills in has no `replacement` field, so there is nowhere for suggested prose to go. If a note smuggles wording in anyway — a quoted phrase that does not appear in your draft — the app redacts that span in the sidebar and you have to click to reveal it. See §10.

**Rule Two: avoid encouragement.**

The schema has no `assessment`, no `strengths`, no `summary`. Praise has nowhere to land. The system preamble forbids it as a second line of defence. The A/B judge (§11) never learns which side you wrote later, and runs on a different provider with no history of the editing session.

Both rules are configurable, in `[rules]` in `config.toml` (§9.1). The defaults are strict. The settings exist because the rules are the author's discipline, not the app's opinion, and because a rule you cannot switch off is a rule you cannot test. Relaxing one is a deliberate edit to a config file, never a button in the interface.

The editor decides the stack. A Notion-style prose editor with span-anchored margin notes exists in one ecosystem only: ProseMirror/TipTap, Lexical, or CodeMirror 6. There is no Rust or Elixir equivalent. A webview and a TypeScript editor layer are therefore fixed costs in every option. The question is only what wraps them.

Tauri wraps them with the smallest binary, a system WebView, and the plugins this app needs: `http` (provider calls from the webview without CORS), `dialog`, `opener`. Rust gets genuine work — storage, the anchoring algorithm in §7, and the CLI runner in §9.3 — rather than being ceremony around a web app.

Svelte 5 over React: less framework per feature, and TipTap mounts imperatively in `onMount`, so the lack of an official Svelte binding costs nothing.

**Elixir + Phoenix LiveView + elixir-desktop.** The editor fights it. TipTap inside a LiveView hook means two state machines over one document: LiveView's DOM patching and ProseMirror's. You manage it with `phx-update="ignore"` and hand-rolled event plumbing. OTP's strengths — supervision, concurrency, fault tolerance — buy little when peak load is a dozen concurrent HTTP calls on one machine. Packaging and notarising a BEAM app on macOS is more work than `tauri build`. Reconsider this if the app ever becomes multi-user or hosted.

**Phoenix on localhost, no shell.** Simplest to build and to open source. Rejected because it is not a desktop app.

**Electrobun.** v1 shipped in February 2026 and 2.0 is current. Small binaries, 4 KB delta updates. Its pitch is "all TypeScript", which points the wrong way here, and the plugin surface is much smaller than Tauri's.

**Tauri with a Phoenix sidecar.** Gets Elixir into the picture at the cost of BEAM bundling, a second runtime, and about 30 MB. Not worth it for this.

Checked against the registries on 21 September 2026.

The last two rows were checked on 23 September 2026. `webdriverio` and the WebDriver plugin are for driving the app in tests and in dev (§16). `prosemirror-search` does find and replace (§12.6). `webdriverio` is a dev dependency, and a release build does not register the plugin.

The npm side has no model provider package. Every provider call runs in Rust through `genai` (§9.2), so the webview neither holds a key nor makes a request.

`serde_yaml` is deprecated, so pass files use TOML frontmatter (§8.1) rather than YAML, which also means one config language across the project.

**Boundary rule.** Rust owns durable state, the filesystem, subprocesses, string matching and every network call. TypeScript owns the editor, orchestration, prompt building, parsing and position mapping. Neither reaches across.

A draft is a Markdown file on disk, in any folder (§6.3). An untitled draft lives in a recovery file until its first save. The app reads and writes that file and nothing else owns it. You can edit it in another editor, keep it in git, and delete the database without losing a word.

The database holds everything the Markdown file cannot: revisions, findings, runs and duels. If the database is missing it is rebuilt empty and the drafts still open.

Conversion is explicit and lossless for the subset the editor supports: paragraphs, headings, emphasis, strong, code, code blocks, blockquotes, lists, horizontal rules, links and hard breaks. `markdown.ts` wraps `prosemirror-markdown` with TipTap's node names, which differ (`codeBlock` for `code_block`, `bold` for `strong`, and so on). Anything outside the subset round-trips as literal text rather than being dropped.

Saving writes the file first and the revision row second. A failed write is reported and does not advance the revision history. Files are written through a temporary file and a rename, and always end with a newline.
