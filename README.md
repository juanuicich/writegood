<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="writegood icon">
</p>

# writegood

A desktop app that finds problems in your prose and refuses to fix them.

You write a draft. You run editing passes over it. Each pass is a prompt you
wrote. A model reads the draft and marks what it finds in the margin. You do
the rewriting.

<p align="center">
  <img src="docs/light.png" width="49%" alt="writegood in the light theme, with findings in the margin">
  <img src="docs/dark.png" width="49%" alt="writegood in the dark theme, with findings in the margin">
</p>

The idea comes from Thomas Ptacek's [*How To Write With An
LLM*](https://sockpuppet.org/blog/2026/09/17/how-to-write-with-an-llm/). The
app enforces the two rules from that article:

- **No model words in your text.** There is no Accept button. A finding says
  where the problem is and what it is. It never gives you replacement text.
- **No praise.** An empty result says "no findings", not "looks great".

## Status

I built this for myself, and it shows. It runs on my Mac. It may run on
yours. Windows and Linux compile, as far as anyone knows. Nobody has
tested them.

Expect rough edges, missing features and the occasional lost afternoon. The
design is in [`SPEC.md`](./SPEC.md). The known gaps are in
[`DEVLOG.md`](./DEVLOG.md), and the list is not short.

## Running it

You need [Bun](https://bun.sh) and a Rust toolchain.

```
bun install
bun run app         # dev build
bun run app:build   # release .app
```

On first launch the app creates `~/.writegood` with a `config.toml` and nine
starter passes. Point `config.toml` at an API key in the keychain, an
environment variable or a `.env` file. Then press `⌘R` to run the passes.
`⌘K` opens everything else.

It works with Anthropic, OpenAI, Google and anything OpenAI-compatible. It can
also run passes through the `claude` or `codex` CLIs.

With DeepSeek Flash and thinking off, the starter passes review a 500-word
draft in about four seconds, except paragraph order, which thinks and takes
about a minute. A run costs about three cents. A 5,000-word chapter takes
about 25 seconds, two minutes for paragraph order, and ten to twenty cents. The
app saves every answer, so a rerun asks only about the paragraphs you changed.

[`BENCHMARKS.md`](./BENCHMARKS.md) has the measurements behind those numbers,
the setup I use, and how to run the passes on a plan you already pay for.

## Tests

```
bun test src/lib
cd src-tauri && cargo test
bun run e2e
```

None of them need a network or an API key. They pass, which is more than most
of the features can say.

## License

Not decided yet.
