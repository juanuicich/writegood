//! Ask a provider one question, from the command line.
//!
//! The prompt is built by the app's own TypeScript, written to a file and
//! handed here, so what this exercises is the real path: the app's preamble
//! and prompt builder, then the app's network client. `dev/probe.ts` drives it.
//!
//! Run it with `cargo run --example probe --`. It lives in `examples/`
//! rather than `src/bin/` because a second binary in `src/bin` makes Tauri
//! bundle the wrong one into the .app.
//!
//! Usage:
//!   probe --provider <name> --system <file> --prompt <file>
//!   probe --provider <name> --jev <file>
//!
//! With `--jev`, the file holds `{"state": ..., "questions": ...}` as
//! `src/lib/passes/jev.ts` built them. The request goes through `jev::ask`,
//! as the app sends it, and the reply goes to stdout as JSON.

use writegood_lib::{config, jev, llm, prices};

fn arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    let config = match config::load_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("config: {e}");
            std::process::exit(2);
        }
    };

    let name = arg(&args, "--provider").unwrap_or_else(|| config.default_provider.clone());
    let Some(provider) = config.providers.get(&name) else {
        eprintln!("no provider '{name}' in config.toml");
        std::process::exit(2);
    };

    let read = |flag: &str| -> String {
        match arg(&args, flag) {
            Some(path) => std::fs::read_to_string(&path).unwrap_or_else(|e| {
                eprintln!("{path}: {e}");
                std::process::exit(2);
            }),
            None => String::new(),
        }
    };

    if let Some(path) = arg(&args, "--jev") {
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            eprintln!("{path}: {e}");
            std::process::exit(2);
        });
        let request: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|e| {
            eprintln!("{path}: {e}");
            std::process::exit(2);
        });
        if let Err(e) = prices::refresh_if_stale().await {
            eprintln!("probe: {e}");
        }
        match jev::ask(&name, provider, &request["state"], &request["questions"]).await {
            Ok(reply) => println!("{}", serde_json::to_string(&reply).unwrap()),
            Err(e) => {
                eprintln!("probe: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let system = read("--system");
    let prompt = read("--prompt");
    if prompt.is_empty() {
        eprintln!("usage: probe --provider <name> --system <file> --prompt <file>");
        std::process::exit(2);
    }

    eprintln!(
        "probe: {name} ({}), {} characters, ceiling {}s",
        provider.model.as_deref().unwrap_or(&provider.kind),
        prompt.len(),
        provider.timeout_secs,
    );

    // The app refreshes the price catalog at startup; do the same, so the
    // cost reported here is the cost the app would record.
    if let Err(e) = prices::refresh_if_stale().await {
        eprintln!("probe: {e}");
    }

    let started = std::time::Instant::now();
    match llm::chat(&name, provider, &system, &prompt).await {
        Ok(reply) => {
            eprintln!("probe: answered in {:.1}s", started.elapsed().as_secs_f64());
            match (reply.tokens, reply.cost_usd) {
                (Some(t), Some(c)) => eprintln!(
                    "probe: {} in ({} cache read, {} cache write), {} out, ${c:.6}",
                    t.input, t.cache_read, t.cache_write, t.output
                ),
                (Some(t), None) => eprintln!(
                    "probe: {} in, {} out, no price for this model",
                    t.input, t.output
                ),
                (None, _) => eprintln!("probe: the provider reported no usage"),
            }
            // Only the reply goes to stdout, so the caller can parse it.
            println!("{}", reply.text);
        }
        Err(e) => {
            eprintln!("probe: {e}");
            std::process::exit(1);
        }
    }
}
