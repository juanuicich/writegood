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

use writegood_lib::{config, llm};

fn arg(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
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

    let started = std::time::Instant::now();
    match llm::chat(provider, &system, &prompt).await {
        Ok(text) => {
            eprintln!("probe: answered in {:.1}s", started.elapsed().as_secs_f64());
            // Only the reply goes to stdout, so the caller can parse it.
            println!("{text}");
        }
        Err(e) => {
            eprintln!("probe: {e}");
            std::process::exit(1);
        }
    }
}
