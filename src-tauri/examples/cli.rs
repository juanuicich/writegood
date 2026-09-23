//! Run one prompt through a `cli` provider, with the app's own runner.
//!
//! The benchmark calls agy through this example, so the command line, the
//! empty working directory, the files written into it and the timeout are the
//! ones `runner::cli_run` makes in the app (SPEC §9.3). Nothing here builds a
//! command line.
//!
//! Usage:
//!   cli --config <toml> --provider <name> --prompt <file>
//!       [--model <m>] [--thinking <level>] [--timeout <secs>]
//!       [--command <path>] [--stdout]
//!
//! `--config` names a TOML file with a `[providers.<name>]` block in the
//! shape of `config.toml`. `--model`, `--thinking` and `--timeout` replace the
//! block's values, as a pass's `thinking` and `timeout_secs` do in the app.
//! `--command` replaces the command, so a test can see the arguments the
//! runner builds. `--stdout` prints the command's whole stdout instead of the
//! `json_path` field; `json_error` still applies. The benchmark uses it to
//! read agy's token counts.

use std::collections::BTreeMap;

use serde::Deserialize;
use writegood_lib::{config::Provider, runner};

#[derive(Deserialize)]
struct File {
    providers: BTreeMap<String, Provider>,
}

fn arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn fail(message: &str) -> ! {
    eprintln!("cli: {message}");
    std::process::exit(2);
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(config), Some(name), Some(prompt_file)) = (
        arg(&args, "--config"),
        arg(&args, "--provider"),
        arg(&args, "--prompt"),
    ) else {
        fail("usage: cli --config <toml> --provider <name> --prompt <file>");
    };

    let text = std::fs::read_to_string(&config).unwrap_or_else(|e| fail(&format!("{config}: {e}")));
    let file: File = toml::from_str(&text).unwrap_or_else(|e| fail(&format!("{config}: {e}")));
    let Some(mut provider) = file.providers.get(&name).cloned() else {
        fail(&format!("no provider '{name}' in {config}"));
    };
    let prompt = std::fs::read_to_string(&prompt_file)
        .unwrap_or_else(|e| fail(&format!("{prompt_file}: {e}")));

    if let Some(model) = arg(&args, "--model") {
        provider.model = Some(model);
    }
    if let Some(level) = arg(&args, "--thinking") {
        provider.thinking = Some(level);
    }
    if let Some(secs) = arg(&args, "--timeout") {
        provider.timeout_secs = secs
            .parse()
            .unwrap_or_else(|_| fail("--timeout takes whole seconds"));
    }
    if let Some(command) = arg(&args, "--command") {
        provider.command = Some(command);
    }
    if args.iter().any(|a| a == "--stdout") {
        provider.json_path = None;
    }

    match runner::cli_run(provider, prompt).await {
        // Only the answer goes to stdout, so the caller can parse it.
        Ok(out) => print!("{out}"),
        Err(e) => {
            eprintln!("cli: {e}");
            std::process::exit(1);
        }
    }
}
