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

<details>
<summary>Installing Bun and Rust</summary>

The project is developed and tested on macOS only. The Linux and Windows steps
are untested, and you use them at your own risk.

**macOS**

Install Bun with [mise](https://mise.jdx.dev). First install mise:

```
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
```

With Homebrew, run `brew install mise` instead. Then the activation line is
`eval "$(mise activate zsh)"`. Open a new shell after either one.

Then install Bun and check it:

```
mise use -g bun@latest
bun --version
```

Install Rust with [rustup](https://rustup.rs). The project needs Rust 1.82 or
later.

```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustc --version
cargo --version
```

**Linux**

Install mise with the same `curl https://mise.run | sh` command. For bash, the
activation line goes in `~/.bashrc`:

```
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
```

For zsh, use the macOS line. Open a new shell, then run
`mise use -g bun@latest`. Install Rust with the same rustup command as on
macOS.

Tauri also needs system libraries such as WebKitGTK. The
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux) page
lists the packages for each distribution. On Debian or Ubuntu:

```
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

**Windows**

Install mise with `winget install jdx.mise` or `scoop install mise`. Add this
line to your PowerShell profile (`$PROFILE`):

```
(&mise activate pwsh) | Out-String | Invoke-Expression
```

Open a new PowerShell, then run `mise use -g bun@latest`.

Install Rust with `winget install --id Rustlang.Rustup`, or run
`rustup-init.exe` from [rustup.rs](https://rustup.rs). Choose the MSVC
toolchain. If Rust is already installed, run `rustup default stable-msvc`.

Tauri also needs the Microsoft C++ Build Tools and WebView2. Windows 10
(version 1803 and later) includes WebView2. The
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows) page
has the installer links.

</details>

```
bun install
bun run app         # dev build
bun run app:build   # release .app
```

On first launch the app creates `~/.writegood` with a `config.toml` and nine
starter passes. Point `config.toml` at an API key in the keychain, an
environment variable or a `.env` file. Then press `⌘R` to run the passes.
`⌘K` opens everything else.

### Keys

Each provider in `config.toml` has a `key_ref`. It takes one of two forms:

- `keychain:<service>/<account>` reads the key from the macOS Keychain.
- `env:NAME` reads the environment variable `NAME`.

If the variable is not set, an `env:` reference falls back to a `.env` file.
The app looks in `$WRITEGOOD_HOME` (by default `~/.writegood`), then in the
working directory and its parents.

An app opened from Finder or the Dock inherits almost nothing from a shell.
For a built app, put the keys in `~/.writegood/.env`:

```
DEEPSEEK_API_KEY=...
TYPESAFE_API_KEY=...
```

Never commit a `.env` file.

It works with Anthropic, OpenAI, Google and anything OpenAI-compatible. It can
also run passes through the `claude` or `codex` CLIs. The filler-words pass can
run on Jev, TypeSafe's decision model, which answers questions about the text
and writes none.

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

## Licence

MIT. See [`LICENSE`](./LICENSE).
