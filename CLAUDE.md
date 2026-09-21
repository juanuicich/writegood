# writegood — working notes for Claude

Read `SPEC.md` before doing anything. It is the design of record.

## Status

Specification only. No code exists yet. `SPEC.md` §14 has the build order.

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

None yet. Once §14 step 1 is done they will be:

```
bun run app          # tauri dev
bun run app:build    # tauri build
bun run check        # svelte-check
cargo test           # from src-tauri/, the anchoring suite lives here
```

## Where the risk is

Anchoring (`SPEC.md` §7). A finding points at a sentence the author is about to
rewrite. If re-anchoring is not solid, nothing built on top of it works. Build
it against fixtures, with tests, before any model is involved.
