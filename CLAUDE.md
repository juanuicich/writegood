# writegood — working notes for Claude

Read `SPEC.md` before doing anything. It is the design of record.

## Status

All seven steps in `SPEC.md` §14 are built: editor, Markdown storage,
anchoring, the pass runner, providers, revisions and the duel. Passes have run
against a real provider end to end. `SPEC.md` §15 lists what is open, and
`DEVLOG.md` records the assumptions and gaps.

## Working agreement

Write the spec or the plan first. Deciding a stack, a library or an approach is
not permission to create project files. Wait for an explicit "build it".

Research that informs the design is always fine: checking current package
versions, reading an API reference, confirming an approach works.

## This repository is public

Anyone can read every commit, including the history. Commit only what can be
shared. Never commit API keys, tokens, `.env` files, personal email
addresses, local paths under a home directory, or the author's private
writing. Benchmark drafts and model replies must come from text that is safe
to publish. When unsure whether a file can be shared, leave it uncommitted and
ask.

## Hard constraints

These come from the two rules in `SPEC.md` §2. They are not preferences, and a
feature request that breaks one of them needs a conversation, not a patch.

1. **The app never puts model-generated words into the document.** No Accept
   button, no apply action, no "insert suggestion". The finding schema has no
   `replacement` field and must not grow one.
2. **The app never carries model praise.** The schema has no `assessment`,
   `strengths` or `summary` field. An empty result renders as "no findings",
   never as "looks good".
3. **The A/B judge runs blind.** Different vendor from the pass, fresh session,
   no editing history, shuffled sides, no hint which version is newer.

## Stack

Tauri v2 shell · Svelte 5 + TypeScript · TipTap 3 on ProseMirror · Rust core ·
SQLite via `rusqlite` · `genai` for providers · Bun toolchain.

Pinned versions are in `SPEC.md` §4.3, verified 21 and 23 September 2026.
Check the registry rather than trusting a recalled version number.

## Conventions

- **Boundary.** Rust owns durable state, the filesystem, subprocesses, string
  matching and every network call. TypeScript owns the editor, orchestration,
  prompt building, parsing and position mapping. Neither reaches across.
  Provider calls moved to Rust because macOS suspends a webview whose window is
  not visible, which froze a pass mid-run.
- **Offsets** are Unicode scalar values on both sides — not bytes, not UTF-16
  code units. TypeScript builds its table with `Array.from(text)`.
- **Config is TOML**, including pass frontmatter. `serde_yaml` is deprecated and
  one config language is enough.
- **Serde** structs use `#[serde(rename_all = "camelCase")]` so the TypeScript
  side reads idiomatic fields.
- **Providers** are called from `llm.rs` with `genai`, which resolves the key,
  the endpoint and the adapter from `config.toml`. The frontend only names a
  provider; a missing key or model is Rust's to report, because Rust is what
  tries.

## Prose in the app and in this repo

The app is about writing plainly, so its own copy follows the same rules. One
idea per sentence. Active voice. No praise, no filler, no rhetorical emphasis.
Say "no findings", not "nothing to worry about".

This applies to commit messages, comments and documentation too.

## Commands

```
bun run app          # tauri dev
bun run app:build    # tauri build
bun test src/lib     # frontend unit tests
bunx svelte-check --tsconfig ./tsconfig.json
bun run check:bench  # type-checks bench/, which svelte-check does not cover
bun test bench       # checks the bench's agy block against SPEC and the runner
cd src-tauri && cargo test && cargo clippy --all-targets
bun run e2e          # builds a debug binary, then drives the real app
```

Both unit suites must pass before a commit. Neither needs a network or an API
key. `bun run e2e` needs neither either: each test file launches the app with a
throwaway home and a fake model served from the test process (SPEC §16.2).

## Checking work against a real model

`bun dev/probe.ts <pass-slug> [provider]` runs one pass against a real provider
without launching the app. It builds the prompt with the app's own preamble and
prompt builder, hands it to the app's own client through
`cargo run --example probe`, and reads the reply with the app's parser — so
every part of the path is the part that ships. `--raw` prints the unparsed
reply. `bun dev/probe-duel.ts [provider] --repeat N` does the same for the
judge. They have found four real bugs between them, so reach for one before
assuming a prompt is the problem.

The probe lives in `src-tauri/examples/`, not `src/bin/`: a second binary under
`src/bin` makes Tauri bundle the wrong one into the `.app`.

To run passes in the app at launch, against the real home and a real
provider, set `VITE_WRITEGOOD_AUTORUN` to a pass slug or `all`:

```
VITE_WRITEGOOD_AUTORUN=nominalization bun run app
```

That hook predates the WebDriver server below. `screencapture` still fails,
because it needs accessibility permission a terminal does not have.

## Driving the real window

A debug build runs a WebDriver server on 127.0.0.1:4445 (SPEC §16).
`bun dev/drive.ts` talks to it while `bun run app` is running:

```
bun dev/drive.ts shot /tmp/app.png     # screenshot of the page
bun dev/drive.ts text                  # the editor's text
bun dev/drive.ts eval 'document.title' # run JavaScript in the page
bun dev/drive.ts keys Escape j         # send keys
```

A dev build uses the real `~/.writegood`. Before `click`, `keys` or `type`,
start it with `WRITEGOOD_HOME` pointing at a scratch directory. The driver
cannot reach the menu bar or the clipboard, and it drops ⌘ from Enter and the
arrows. SPEC §16.1 lists the limits.

## Looking at the interface

`bun run browser` serves the app at http://localhost:1421 with Tauri replaced
by fixtures in `dev/browser/`. Nothing touches disk and no key is needed. Add
`?theme=dark`, and `?show=review|history|duel|palette|find` to open straight into a
state worth reviewing. Screenshot it with headless Chrome:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --virtual-time-budget=4000 \
  --window-size=1280,860 --screenshot=/tmp/ui.png \
  "http://localhost:1421/?show=review"
```

This is the quickest way to see the design. It has already caught paragraph
spacing that had been cancelled by a later rule, colliding margin notes, a
clipped command bar and timestamps rendered in UTC. To see the real WebKit
window instead, use `bun dev/drive.ts shot` against a dev build. Look at a
screenshot before claiming a visual change works.

Keys come from the macOS keychain or from `env:NAME`, which falls back to a
`.env` file. `.env` is in `.gitignore` and must stay there.

## Where the risk is

Anchoring (`SPEC.md` §7). A finding points at a sentence the author is about to
rewrite. If re-anchoring is not solid, nothing built on top of it works. Build
it against fixtures, with tests, before any model is involved.
