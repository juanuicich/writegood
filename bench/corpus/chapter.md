# Notes on a writing tool

Status: built, 23 September 2026. The build order in §14 is done; §15 lists what is open.

A local desktop app for workshopping your own prose. You write a draft in it. You run editing passes over the draft. Each pass is a prompt you wrote yourself. The app shows you what the model found, anchored to the text it found it in. You do the rewriting.

The shape comes from Thomas Ptacek's How To Write With An LLM (sockpuppet.org, 17 September 2026) and the opening prompt he used to build his own version:

This spec keeps his feature list and his two rules. It changes the stack, and it makes the two rules structural rather than advisory.

The app never inserts text into your document. There is no Accept button and no apply action. A finding is a location plus a description of a problem. The schema the model fills in has no replacement field, so there is nowhere for suggested prose to go. If a note smuggles wording in anyway — a quoted phrase that does not appear in your draft — the app redacts that span in the sidebar and you have to click to reveal it. See §10.

The schema has no assessment, no strengths, no summary. Praise has nowhere to land. The system preamble forbids it as a second line of defence. The A/B judge (§11) never learns which side you wrote later, and runs on a different provider with no history of the editing session.

Both rules are configurable, in [rules] in config.toml (§9.1). The defaults are strict. The settings exist because the rules are the author's discipline, not the app's opinion, and because a rule you cannot switch off is a rule you cannot test. Relaxing one is a deliberate edit to a config file, never a button in the interface.

The editor decides the stack. A Notion-style prose editor with span-anchored margin notes exists in one ecosystem only: ProseMirror/TipTap, Lexical, or CodeMirror 6. There is no Rust or Elixir equivalent. A webview and a TypeScript editor layer are therefore fixed costs in every option. The question is only what wraps them.

Tauri wraps them with the smallest binary, a system WebView, and the plugins this app needs: http (provider calls from the webview without CORS), dialog, opener. Rust gets genuine work — storage, the anchoring algorithm in §7, and the CLI runner in §9.3 — rather than being ceremony around a web app.

Svelte 5 over React: less framework per feature, and TipTap mounts imperatively in onMount, so the lack of an official Svelte binding costs nothing.

Elixir + Phoenix LiveView + elixir-desktop. The editor fights it. TipTap inside a LiveView hook means two state machines over one document: LiveView's DOM patching and ProseMirror's. You manage it with phx-update="ignore" and hand-rolled event plumbing. OTP's strengths — supervision, concurrency, fault tolerance — buy little when peak load is a dozen concurrent HTTP calls on one machine. Packaging and notarising a BEAM app on macOS is more work than tauri build. Reconsider this if the app ever becomes multi-user or hosted.

Phoenix on localhost, no shell. Simplest to build and to open source. Rejected because it is not a desktop app.

Electrobun. v1 shipped in February 2026 and 2.0 is current. Small binaries, 4 KB delta updates. Its pitch is "all TypeScript", which points the wrong way here, and the plugin surface is much smaller than Tauri's.

Tauri with a Phoenix sidecar. Gets Elixir into the picture at the cost of BEAM bundling, a second runtime, and about 30 MB. Not worth it for this.

The last two rows were checked on 23 September 2026. webdriverio and the WebDriver plugin are for driving the app in tests and in dev (§16). prosemirror-search does find and replace (§12.6). webdriverio is a dev dependency, and a release build does not register the plugin.

The npm side has no model provider package. Every provider call runs in Rust through genai (§9.2), so the webview neither holds a key nor makes a request.

serde_yaml is deprecated, so pass files use TOML frontmatter (§8.1) rather than YAML, which also means one config language across the project.

Boundary rule. Rust owns durable state, the filesystem, subprocesses, string matching and every network call. TypeScript owns the editor, orchestration, prompt building, parsing and position mapping. Neither reaches across.

A draft is a Markdown file on disk, in any folder (§6.3). An untitled draft lives in a recovery file until its first save. The app reads and writes that file and nothing else owns it. You can edit it in another editor, keep it in git, and delete the database without losing a word.

The database holds everything the Markdown file cannot: revisions, findings, runs and duels. If the database is missing it is rebuilt empty and the drafts still open.

Conversion is explicit and lossless for the subset the editor supports: paragraphs, headings, emphasis, strong, code, code blocks, blockquotes, lists, horizontal rules, links and hard breaks. markdown.ts wraps prosemirror-markdown with TipTap's node names, which differ (codeBlock for code_block, bold for strong, and so on). Anything outside the subset round-trips as literal text rather than being dropped.

Saving writes the file first and the revision row second. A failed write is reported and does not advance the revision history. Files are written through a temporary file and a rename, and always end with a newline.

documents.path is absolute and unique, and null for an untitled draft. The row is a pointer and a cache of the title; the file is the document. opened_at orders the recent list (§6.3).

content_json is the ProseMirror document, kept so a revision restores exactly. content_text is the flattened text that anchoring and passes work against.

Revision policy. Consecutive ordinary saves collapse into the newest row, so typing does not bury the revisions you marked. Marking a revision major starts a new row and freezes the previous one. label is your note on why it is major.

findings.status is one of open, addressed, dismissed, stale. Nothing is ever deleted by the app; stale is set by anchoring, not by you.

findings.superseded_at is set when a newer answer replaces the finding (§8.3), or when clear findings clears it. The app does not list or show a superseded finding. The row keeps its status, so a later look at the database still shows what you addressed and what you dismissed. A database made before this column existed gains it at startup, with every row null.

findings.chunk_key names the answer the finding came from: one paragraph of one pass, or one document pass over one draft (§8.3). reviews records every answer the runner has saved, including the answers with no findings, so an unchanged paragraph is not sent again. Its key is (doc_id, pass_slug, chunk_key). A review row is a cache entry, not a record: the app deletes the ones that no longer match the draft, and clear findings deletes them all.

duels.original_won is derived at write time from verdict and a_is_original, so the A/B shuffle never has to be unpicked later.

The three usage columns on runs and duels are nullable (§9.4). A CLI call reports no tokens, so both counts are null. A call with no known price has tokens and a null cost. A database made before these columns existed gains them at startup; the rows it already holds stay null.

A draft can be any Markdown or text file, in any folder. The system open and save dialogs choose the file. ~/.writegood/documents stays as the folder the dialogs start in when no document is open.

Dialogs. Rust shows the dialogs, through tauri-plugin-dialog, which is already a dependency. Rust owns the filesystem, so Rust picks the path as well as reading it. Two commands:

These are the native macOS dialogs. The plugin calls rfd, which shows NSOpenPanel and NSSavePanel. The app draws no file picker of its own.

Both return None when the author cancels. Both filter to .md, .markdown, .mdown and .txt. Both start in the open document's folder, or in ~/.writegood/documents.

The default extension is .md. The save dialog suggests a file name made from the first level-one heading, through slugify, or untitled.md. A name typed with no extension gets .md.

New. ⌘N opens an empty untitled draft. It has no file and asks nothing. The first ⌘S shows the save dialog. Until then, autosave writes the draft to a recovery file, ~/.writegood/untitled/<doc id>.md, so a crash or a quit loses nothing. The first save to a chosen path deletes the recovery file. Cancelling the save dialog leaves the draft untitled, and the recovery file stays.

An untitled draft has a document row, so passes, findings, revisions and the duel work on it before it has a file.

Open. ⌘O shows the open dialog. A path the database already knows opens its existing row, with its history and findings. A new path gets a new row.

Save As. ⌘⇧S shows the save dialog and writes the draft to the new path. The document row moves to the new path, so history and findings follow the draft. The old file stays on disk, unchanged. Save As onto the path of another known document is refused with a message, because two rows cannot share a path.

Major revision. It moves from ⌘⇧S to ⌘⌥S. It still asks what changed. On an untitled draft it shows the save dialog first.

Recent files. The command bar's open list becomes open recent. It lists documents the author has opened in writegood, from any folder, newest first, up to 20. An untitled draft with a recovery file is on the list, so a draft left behind by ⌘N or ⌘O can be found again. A document whose file does not exist now is left out of the list. Its row is kept. The macOS menu has File > Open Recent, a submenu with the same list, rebuilt by Rust whenever a document opens or is saved to a new path. Its items emit open-doc:<id>. The frontend opens that document. It is not a palette command id.

Before another document replaces the draft in the editor, any edit autosave has not written yet is saved.

Launch. The app reopens the most recently opened document. For an untitled draft that is its recovery file. If that file is missing, or there is none, the app opens a new untitled draft. This replaces "open the newest file in the documents folder".

Guard. The webview never names a file to write. doc_save(id, text) writes to the row's path, or to its recovery file. doc_save_as(id, path, text) takes a path, which the save dialog returned, and refuses a path that another row holds before it writes. doc_write is gone.

A file moved outside the app gets a new row when it is opened from its new path. Its old history stays with the old row. Detecting moves is out of scope.

Text files. A .txt file is read as Markdown and written as Markdown. Characters that Markdown treats as syntax, such as  and _, can gain escapes on the first save. The first save of a .txt file shows a line in the status bar that says so.

Commands. doc_pick_open, doc_pick_save, doc_open(path), doc_reopen(id), doc_new, doc_save, doc_save_as and doc_recent, in documents.rs. The open commands return the row and the text together.

Removed. doc_list, doc_read, doc_write, doc_create, doc_rename, doc_delete, db_forget_missing and the title question on new document.

Status bar. An untitled draft shows "untitled" where a saved draft shows its title. The unsaved mark stays on while the draft has no file, because the recovery file is not the author's file.

Browser fixtures and tests. dev/browser/mock-core.ts answers the two pick commands with a fixture path. WebDriver cannot drive a native dialog (§16.1). A debug build therefore reads WRITEGOOD_PICK. It names a file, and both pick commands return that file's first line and show no dialog. An empty line is a cancel. The file is read on every pick, so a test can change the answer. The e2e harness writes it, and each test file opens its draft with ⌘O through it, because a fresh home starts on an untitled draft.

A finding points at a sentence you are about to rewrite. It has to survive that.

Storage format. W3C Web Annotation text quote selector: the exact quote, plus 32 characters of prefix and suffix. No offsets are stored. Offsets die the moment you edit anything above them.

While the document is open. ProseMirror's Mapping moves decoration positions through every transaction. This is free and exact. Use it.

On load, and after any pass. Re-anchor from the selectors. Rust does the string matching; TypeScript maps the result back to ProseMirror positions.

Stale is a correct and common outcome. It means you rewrote the sentence, which is what the app is for. Stale findings grey out; they do not vanish.

Offsets are Unicode scalar values — not bytes, not UTF-16 code units — on both sides of the boundary. TypeScript builds its position table with Array.from(text) so the two agree.

Position mapping (text.ts): walk the ProseMirror doc collecting text nodes into a flat string, recording one entry per code point holding its ProseMirror position. A Rust character offset then indexes straight into that table.

Plain files in ~/.writegood/passes/, TOML frontmatter, prompt body. Keep the directory in git. You will rewrite these constantly, and that is the point — the prompts are the part of this tool that is yours.

scope = "paragraph" splits the draft and fans out one call per paragraph, with the whole draft supplied as context. scope = "document" sends the draft once. Paragraph scope is better for local problems and gives faster first results. Document scope is needed for anything about order, flow or repetition.

thinking and timeout_secs override the provider's values for this pass alone. A pass that needs reasoning over the whole draft, such as paragraph order, can think while the others do not (§8.3).

Ship a starter set, clearly marked as a starting point to be replaced. Derived from Style: Lessons in Clarity and Grace, which Ptacek names as the source worth stealing from:

nominalization, passive-actor, sentence-openings, filler-words (very / really / actually / unfortunately), repeated-phrasing, paragraph-order, topic-flow, unearned-metaphor, length (which 750 words are doing no work).

The starters live in src-tauri/passes/ and are written into a new home. Each one states a test to apply, what not to flag, the exact span to quote, what each severity means, and what the note may say. A fast model over-flags, so the "do not flag" lists carry most of the weight. topic-flow checks links inside each paragraph, so it runs at paragraph scope. paragraph-order is the one starter with thinking = "high": without reasoning over the whole draft, it missed most misplaced paragraphs (§8.3).

The runner queues every call of every enabled pass at once: one call for a document-scope pass, one per paragraph for a paragraph-scope pass, less the calls whose answers are saved (below). One limit bounds the calls in flight across the whole run, at 32. A pass takes about as long as its slowest call, not the sum of its calls. Passes that think are queued first, because their calls are the slowest.

Two stages for a pass that does not think. A model with thinking off answers in one or two seconds, finds nearly every real problem, and reports about two false ones for each real one. So a pass with thinking off runs in two stages:

A pass with thinking on skips both stages. It has already checked its own work, and it stores each call's findings as the call returns.

The design was measured on four drafts against 82 reference findings written by a stronger model. With thinking off for eight passes, verification, and thinking on for paragraph order alone, F1 was 71–72%, the same as thinking on for every pass (67–71%). The first findings came after about six seconds instead of two to three minutes, and a run cost about a sixth as much.

A pass that fails marks its run error, keeps whatever arrived before the failure, and leaves the other passes alone. After its first failed call it starts no more calls. Its calls already in flight finish, and their findings are kept, because they are paid for.

Windows. A paragraph-scope call does not send the whole draft. It sends the window its paragraph belongs to.

The boundaries depend on the paragraphs' text, not on their positions. An edit can move only the boundaries near it: the windows before it are unchanged, and the windows after it usually return to the same boundaries within a few paragraphs. Unchanged windows send the same text on the next run, so the provider's prompt cache still holds them.

Windows bound the input of a call. With the whole draft in every call, a run's input grows with the square of the draft's length: a 5,000-word chapter with 60 paragraphs sent about 3.4 million tokens. With windows it grows in line with the length.

A window's text carries the header --- an excerpt of the draft --- in place of --- the draft ---. Document-scope passes always send the whole draft.

Prompt order. Each prompt is the system preamble, then the draft or the window, then the pass prompt, then the paragraph to examine. Every call of a window therefore starts with the same tokens. DeepSeek caches a repeated prefix without being asked, and charges about a tenth of the input price for the cached part. The cache holds a prefix only after a call that sent it has finished, so the first calls of a run all miss it. The pass prompt comes after the draft, as Anthropic's long-context guidance advises for a long document and a short task. Anthropic caches only a prefix marked with cache_control, which the app does not set.

Findings arrive a pass or a call at a time rather than one finding at a time. A verified pass stores its findings once, when verification ends. A pass with thinking on stores each call's findings as the call returns: a document-scope pass makes one call, and a paragraph-scope pass makes one per paragraph. The margin shows stored findings at once. No pass waits for another. Both backends end at the same place — a block of text that should contain a JSON array — and parse.ts reads it. Per-element structured-output streaming does not survive provider switching: an endpoint without structured-output support returns a bare array where the caller expects a wrapper, and the result is silently zero findings. One code path with one failure mode is worth more here than per-element streaming.

An item that fails the schema is dropped, so one malformed entry does not discard the nine good ones beside it. If every item across a whole pass fails and there was at least one, the pass fails instead: a provider that has changed its field names must not read as a clean nothing-found. The check covers the pass, not each reply. A paragraph pass makes one call per paragraph, and with dozens of calls one reply whose only item is bad is likely; it must not fail the pass. A genuinely empty array stays silent, because finding nothing is a normal result.

A reply that cannot be read says which of four things went wrong, because each implies a different remedy:

[rules] # Rule One. Defaults keep the model's wording out of your draft entirely. allow_suggestions   = false  # true adds a replacement field and an apply action redact_suggestions  = true   # block wording that leaked into a note (§10.3) # Rule Two. forbid_praise       = true   # the no-encouragement preamble blind_judge         = true   # shuffle A/B, strip history, require a second vendor

[appearance] font        = "ui-serif" font_size   = 19 measure     = 68             # characters per line theme       = "light"        # light | dark | system show_cost   = false          # the file's running cost in the status bar (§9.4)

[providers.anthropic] kind    = "anthropic" model   = "claude-opus-5" key_ref = "keychain:writegood/anthropic"

[providers.openai] kind    = "openai" model   = "gpt-5.2" key_ref = "env:OPENAI_API_KEY"

[providers.local] kind     = "openai-compatible" base_url = "http://localhost:11434/v1" model    = "qwen3:32b" catalog  = "ollama"          # its id in the price catalog, when the name differs (§9.4)

FIXED — a fenced quotation hid the findings. The fence pattern matched the first fence of any kind, so a reply that quoted the draft in a plain fence before the array lost the array entirely. Fences are now searched in order of usefulness.

DECISION — the quote lower bound stays at two characters. The validator and its own description disagreed, and I first corrected the wrong one. A short quote anchors perfectly well, because it is placed with thirty-two characters of context either side, and a filler-words pass has every right to quote "so". Only the upper bound means anything.

NOTE — a dead branch was kept on purpose. parseFindings guards against a non-array, which extractArray can no longer produce. Two lines of guard are worth keeping against a future change to the extractor.

FIXED — a truncated reply is loud again. Collecting every balanced array meant [{"a": [1]} returned the inner [1] rather than null, turning a throw into a quietly empty pass. The fallback span must now start at the candidate's first [. A throw names the provider and gets noticed; an empty pass looks like a clean nothing-found and does not.

DECISION — a real array beats an earlier empty one. nothing in this paragraph: [] followed by the actual findings is a plausible reply, and the first rule read it backwards. The order is now: the first non-empty array of objects, else any array of objects, else the first balanced array of the first candidate that has one. A lone [] still means no findings.

FIXED — the last quiet path, and three misleading messages. A reply that could not be read used to say one thing whatever had happened. It now says which of four, because each implies a different fix: items that fail the schema, a reply cut off mid-array, an array holding no findings, or no array at all. A well-formed array whose every item fails the schema now throws with the count and the first Zod issue, rather than returning nothing silently — a provider that renames a field must not read as a clean nothing-found. Dropping individual malformed items is unchanged, and an empty array is still silent.

DECISION — no fallback to an array of non-objects. It existed to avoid throwing, and throwing is the point: it named the provider and got noticed, where an empty pass looked like success. Nothing valid was lost, since a real findings array always starts with {.

NOTE — a stray unclosed [ in prose reads as truncation. I looked at paragraph [3 reports "probably cut off". Weighing where the bracket sits is more machinery than the case deserves, which is why the wording hedges.

FIXED — the app did not build for release. tauri build failed on zerofrom, then phf, then serde: every proc-macro dependent, each unable to find its own derive crate. Proc macros and build scripts run on the host at compile time and inherit the release profile, and strip and opt-level leave them in a form rustc cannot load. [profile.release.build-override] builds them plainly while the app keeps lto, opt-level = "s" and strip. This had been broken since the first commit and would only have shown up the day you tried to ship.

FIXED — bun run app:build exited non-zero. The DMG step needs hdiutil, which fails outside an interactive session. Bundle targets are now ["app"] only. Re-add "dmg" when you want something to hand to other people.

REMOVED — macOSPrivateApi. Switched on for a transparency effect the app does not use.

ADDED — a log file. ~/.writegood/writegood.log, trimmed at half a megabyte. The pass runner records every call, its size, its ceiling and its answer; boot records what it loaded; uncaught errors and unhandled rejections land there too. A built app has no visible console, so without this a pass that dies takes its explanation with it. Adding it should have been the first move rather than the last: it answered in one run what four rounds of inference about lsof output and CPU readings had got wrong.

OPEN — a pass stops when the window is not visible. The evidence, from the built app: call one answers in two seconds, call two is logged as starting and nothing follows. No TCP connection, no CPU, and the setTimeout that enforces the per-call ceiling never fires either. A timer that does not run is the signature of a suspended WebKit process, which is what macOS does to an occluded window under App Nap. It reproduces in tauri dev and in the built bundle alike, and only while the window is not in front.

That makes it an artifact of running the app unattended — a real user has the window open — but it is still a genuine limit: start nine passes, switch to your browser, and the run may freeze. The honest fix is to move provider calls out of the webview into Rust, where nothing suspends them. That is a real architectural change and wants your agreement first, so it is not done.

NOTE — a launched app finds no .env in a repository. Double-clicked or opened with open, the app inherits no environment and starts in /, so the key must live in ~/.writegood/.env or the keychain. Launched from the project directory it finds the repository's .env and works, which is what masked this. The error now says exactly what to do.

DONE — genai replaces the Vercel AI SDK. Every network call now runs in llm.rs as a tokio task. The freeze is gone: four calls, window unfocused, sixty-two seconds, four findings. That is the exact condition that used to stop a pass after the first call with no error and no timeout.

genai is the closest Rust equivalent of the AI SDK's core — one call shape across Anthropic, OpenAI, Gemini, DeepSeek, Ollama and OpenRouter, with a ServiceTargetResolver for the rest. rig-core is more popular but is an agent framework, far heavier than "send two strings, get text".

I should have surfaced this in the original stack proposal. I weighted "best provider abstraction" heavily, chose the AI SDK on that basis, and never checked whether the runner-up was good enough. It was, and choosing it would have avoided the freeze entirely.

Out: ai, three @ai-sdk/ packages, @tauri-apps/plugin-http and its capability entry. Keys no longer reach the webview at all.

DECISION — the probe drives the Rust client. dev/probe.ts builds the prompt with the app's preamble and prompt builder, hands it to cargo run --example probe, and parses the reply with the app's parser. Every part of the path ships. Same for dev/probe-duel.ts.

FIXED — a second binary made Tauri bundle the wrong one. The probe started life in src-tauri/src/bin/, and the .app then contained probe rather than writegood. It did not crash; it simply was not there, and an empty log was the only symptom. It lives in examples/ now.

DONE — a real macOS menu, in menu.rs. writegood, File, Edit, Review, Window. Every custom item carries the accelerator the keyboard already used and emits the id of a palette command; the palette runs it. One code path, so the menu and the keyboard cannot drift. The Edit submenu matters most: WKWebView takes Undo, Cut, Copy, Paste and Select All from the menu, and the default Tauri menu was the only reason they worked at all.

The menu is #[cfg(target_os = "macos")]. On Windows and Linux Tauri draws the menu inside the window frame, above the document, which is the in-app chrome SPEC §12.1 rules out. Those platforms get the keyboard and ⌘K.

It is built through Builder::menu, not AppHandle::set_menu in setup. A menu set in setup does not take: the window already exists with the default menu and keeps it. The symptom is a menu bar that still reads File, Edit, View, Window, Help.

FIXED — "open the writegood folder" did nothing. The palette called the opener plugin from the webview, and the capability file granted opener:default, which covers open-url and reveal-item-in-dir but not open-path. The rejection never reached the screen. The log had it: Command plugin:opener|open_path not allowed by ACL. There is a shell_open_path command in Rust now, which is where the filesystem belongs, and the menu item calls tauri_plugin_opener::open_path directly.

FIXED — cargo run could not choose a binary. default-run = "writegood" in Cargo.toml. The probe had already moved to examples/, which removed the ambiguity; the manifest key makes it stay removed.

Two behaviours changed with the accelerators. ⌘⇧S now asks what changed instead of saving a revision labelled "major revision", and ⌘⇧⏎ now asks which pass to run, which is what the palette had always advertised. Both go through the palette command the menu item names.

DONE — the status bar can show what the open file has cost. Off by default; show_cost = true under [appearance] turns it on. SPEC §9.4 has the design.

DECISION — prices come from models.dev. One public file, no key, rates per million tokens for input, output, cache read and cache write. llmcatalog.dev serves price history one model at a time and has no bulk catalog, so it cannot answer a lookup. We keep a slim copy, 517 KB against the source's 4.8 MB, at ~/.writegood/prices.json, refreshed in the background when a week old.

DECISION — the vendor is the provider's table name. kind cannot be used: openai-compatible is a protocol, not a vendor. Both configured providers, deepseek and anthropic, match the catalog as they are. catalog = "..." covers a provider whose name differs.

ASSUMPTION — a part-priced run counts as unpriced. If any call in a run has tokens but no price, the run records tokens and a null cost, and the status bar counts it under "tokens unpriced". The dollar figure is then short by nothing it claims to include. Needs checking: whether you would rather see the priced part in dollars.
