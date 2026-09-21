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
