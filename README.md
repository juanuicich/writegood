# writegood

A local desktop app for workshopping your own prose.

**Status: early, and usable.** You can write in it, run your editing passes
over a draft, step through what they found, compare a rewrite against your
first draft, and walk back through revisions. The design is in
[`SPEC.md`](./SPEC.md); the assumptions and the known gaps are in
[`DEVLOG.md`](./DEVLOG.md).

## The idea

You write a draft. You run editing passes over it. Each pass is a prompt you
wrote yourself. The app shows you what the model found, anchored to the text it
found it in.

You do the rewriting. All of it.

The shape comes from Thomas Ptacek's [*How To Write With An
LLM*](https://sockpuppet.org/blog/2026/09/17/how-to-write-with-an-llm/), which
argues for using a model as a copyeditor rather than a ghostwriter, and sets out
two rules for doing it without your voice leaking away.

## The two rules, enforced by the app

**You may not use a single word the model suggests.** So the app cannot give you
any. There is no Accept button. A finding is a location and a description of a
problem. The schema the model fills in has no field for replacement wording. If
a note smuggles some in anyway, the sidebar blocks it until you click.

**Avoid encouragement.** So the schema has nowhere to put it. No overall
assessment, no strengths, no summary. An empty result says "no findings".

## How it works

1. Write in a plain, Notion-style editor.
2. Run your passes. Each one is a markdown file in `~/.writegood/passes/`,
   version-controlled, entirely yours.
3. Read the findings in a Genius-style margin. Step through them from the
   keyboard.
4. Rewrite a paragraph yourself. The app sends your version and the original,
   shuffled and unlabelled, to a different model in a clean session, and records
   which one won without that model ever knowing which was which.

Over time that last table answers a real question: does your rewriting actually
beat your first draft?

## Running it

```
bun install
bun run app
```

On first launch it creates `~/.writegood` with a `config.toml` and nine starter
passes. Put an API key where `config.toml` points — the macOS keychain, an
environment variable, or a `.env` file — and press `⌘⏎`.

Everything is `⌘K`. There are no menus.

## Stack

Tauri v2 · Svelte 5 · TipTap 3 · Rust · SQLite · Vercel AI SDK v7 · Bun.

Roughly a 10 MB app on the system WebView. Providers are configured in
`~/.writegood/config.toml` and switch by editing one line: Anthropic, OpenAI,
Google, or anything OpenAI-compatible, which covers DeepSeek, OpenRouter,
Ollama and LM Studio. Passes can also run through the `claude` or `codex` CLIs,
which bills against a subscription instead of API credits.

See [`SPEC.md` §4](./SPEC.md#4-stack) for why, including why not Elixir.

## Files

```
~/.writegood/
├── config.toml     providers and defaults
├── writegood.db    drafts, revisions, findings, duels
└── passes/         your prompts, one per file
```

Everything except the database is plain text you can edit and put in git.

## License

Not decided yet.
