# writegood — working notes for Claude

Read `SPEC.md` before doing anything. It is the design of record.

## Status

The bones are up: editor, Markdown storage, anchoring, the pass runner and the
provider layer all work, and one pass has been run against a real provider end
to end. `SPEC.md` §14 has the build order; the duel and the revision viewer are
not built. `DEVLOG.md` records the assumptions and gaps.

## Working agreement

Write the spec or the plan first. Deciding a stack, a library or an approach is
not permission to create project files. Wait for an explicit "build it".

Research that informs the design is always fine: checking current package
versions, reading an API reference, confirming an approach works.

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
SQLite via `rusqlite` · Vercel AI SDK v7 · Bun toolchain.

Pinned versions are in `SPEC.md` §4.3, verified 21 September 2026. Check the
registry rather than trusting a recalled version number.

## Conventions

- **Boundary.** Rust owns durable state, the filesystem, subprocesses and string
  matching. TypeScript owns the editor, model calls and position mapping.
  Neither reaches across.
- **Offsets** are Unicode scalar values on both sides — not bytes, not UTF-16
  code units. TypeScript builds its table with `Array.from(text)`.
- **Config is TOML**, including pass frontmatter. `serde_yaml` is deprecated and
  one config language is enough.
- **Serde** structs use `#[serde(rename_all = "camelCase")]` so the TypeScript
  side reads idiomatic fields.
- **AI SDK v7**: `streamText` with `Output.array({ element })`, consumed through
  `elementStream`. Not `streamObject`.
- **Provider calls** go through `fetch` from `@tauri-apps/plugin-http`, so CORS
  never applies.

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
cd src-tauri && cargo test && cargo clippy --all-targets
```

Both suites must pass before a commit. Neither needs a network or an API key.

## Checking work against a real model

`bun dev/probe.ts <pass-slug> [provider]` runs one pass against a real provider
without launching the app, using the app's own preamble, prompt builder and
parser. `--raw` prints the unparsed reply. It found two real bugs on its first
outing, so reach for it before assuming a pass prompt is the problem.

To exercise the whole in-app path, including Tauri's HTTP plugin, set
`VITE_WRITEGOOD_AUTORUN` to a pass slug or `all` and launch:

```
VITE_WRITEGOOD_AUTORUN=nominalization bun run app
```

That hook exists because driving the window from a script needs accessibility
permission a terminal does not have. `screencapture` fails for the same reason.

## Looking at the interface

`bun run browser` serves the app at http://localhost:1421 with Tauri replaced
by fixtures in `dev/browser/`. Nothing touches disk and no key is needed. Add
`?theme=dark`, and `?show=review|history|duel|palette` to open straight into a
state worth reviewing. Screenshot it with headless Chrome:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --virtual-time-budget=4000 \
  --window-size=1280,860 --screenshot=/tmp/ui.png \
  "http://localhost:1421/?show=review"
```

This is the only way to see the design. It has already caught paragraph
spacing that had been cancelled by a later rule, colliding margin notes, a
clipped command bar and timestamps rendered in UTC. Look at the screenshot
before claiming a visual change works.

Keys come from the macOS keychain or from `env:NAME`, which falls back to a
`.env` file. `.env` is in `.gitignore` and must stay there.

## Where the risk is

Anchoring (`SPEC.md` §7). A finding points at a sentence the author is about to
rewrite. If re-anchoring is not solid, nothing built on top of it works. Build
it against fixtures, with tests, before any model is involved.
