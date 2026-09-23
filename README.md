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
bun run app       # the desktop app: tauri dev
```

`bun run app` is the one you want. It starts Vite and then builds and launches
the Tauri window; the first build takes a few minutes, later ones seconds.

`bun run dev` is not the app. It runs Vite alone, on
[http://localhost:1420](http://localhost:1420), and Tauri runs it for you as
part of `bun run app`. A browser on that port shows an app with no Tauri behind
it, so nothing that touches disk or a provider works. Use `bun run browser`
instead, which serves the interface on port 1421 with fixtures in place of
Tauri.

The rest:

```
bun run app:build   # a release .app bundle
bun run browser     # the interface in a browser, no Tauri, no key
bun test src/lib    # frontend unit tests
bun run check       # svelte-check
bun run e2e         # end-to-end tests against the real app, no key, no network
bun dev/drive.ts    # drive a running dev build from the terminal
```

A debug build carries a WebDriver server on 127.0.0.1:4445, which the
end-to-end tests and `dev/drive.ts` use. A release build does not. SPEC §16
has the details and the limits.

On first launch it creates `~/.writegood` with a `config.toml` and nine starter
passes. Put an API key where `config.toml` points — the macOS keychain, an
environment variable, or a `.env` file — and press `⌘R` or `⌘⏎`.

Everything is `⌘K`. On macOS the same commands are also in the menu bar, which
is where macOS puts menus; nothing is painted inside the window. Windows and
Linux draw a menu inside the window frame, over the text, so they get the
keyboard and `⌘K` only.

`⌘+` and `⌘-` change the text size, body and margin together, and save it to
`config.toml`.

## Stack

Tauri v2 · Svelte 5 · TipTap 3 · Rust · SQLite · `genai` · Bun.

Roughly a 10 MB app on the system WebView. Providers are configured in
`~/.writegood/config.toml` and switch by editing one line: Anthropic, OpenAI,
Google, or anything OpenAI-compatible, which covers DeepSeek, OpenRouter,
Ollama and LM Studio. Passes can also run through the `claude` or `codex` CLIs,
which bills against a subscription instead of API credits.

Set `show_cost = true` under `[appearance]` to see what the open file has cost
so far. Prices come from [models.dev](https://models.dev) and refresh weekly. A
model with no known price shows its token count instead.

See [`SPEC.md` §4](./SPEC.md#4-stack) for why, including why not Elixir.

## Files

```
~/.writegood/
├── config.toml     providers and defaults
├── writegood.db    revisions, findings, runs, duels
├── prices.json     model prices from models.dev
├── documents/      your drafts, Markdown, one per file
└── passes/         your prompts, one per file
```

Everything except the database is plain text you can edit and put in git.

## License

Not decided yet.
