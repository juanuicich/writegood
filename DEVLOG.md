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
