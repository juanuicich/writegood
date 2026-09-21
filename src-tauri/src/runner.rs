//! The CLI provider backend. It runs `claude`, `codex` or anything else that
//! takes a prompt and prints an answer, so passes can bill against a
//! subscription instead of API credits.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

use crate::config::Provider;
use crate::error::{AppError, AppResult};

/// Replace the literal `{prompt}` in every argument. The flag says whether any
/// argument mentioned it; if none did, the prompt goes to stdin instead.
pub fn substitute_args(args: &[String], prompt: &str) -> (Vec<String>, bool) {
    let mut used = false;
    let out = args
        .iter()
        .map(|a| {
            if a.contains("{prompt}") {
                used = true;
                a.replace("{prompt}", prompt)
            } else {
                a.clone()
            }
        })
        .collect();
    (out, used)
}

/// The last `n` characters of a string. Used to keep an error message short
/// when a tool writes a long trace to stderr.
fn tail(text: &str, n: usize) -> String {
    let count = text.chars().count();
    if count <= n {
        return text.to_string();
    }
    text.chars().skip(count - n).collect()
}

#[tauri::command]
pub async fn cli_run(provider: Provider, prompt: String) -> AppResult<String> {
    if provider.kind != "cli" {
        return Err(AppError::invalid(format!(
            "cli_run needs a provider of kind \"cli\", got \"{}\"",
            provider.kind
        )));
    }
    let command = provider
        .command
        .as_deref()
        .filter(|c| !c.trim().is_empty())
        .ok_or_else(|| AppError::invalid("a cli provider needs a command"))?
        .to_string();

    let (args, prompt_in_args) = substitute_args(&provider.args, &prompt);

    let mut cmd = tokio::process::Command::new(&command);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if prompt_in_args {
            Stdio::null()
        } else {
            Stdio::piped()
        })
        // A timeout drops the future that owns the child, and this turns that
        // drop into a kill.
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::other(format!("cannot run {command}: {e}")))?;

    let stdin = if prompt_in_args {
        None
    } else {
        child.stdin.take()
    };

    let work = async move {
        if let Some(mut pipe) = stdin {
            pipe.write_all(prompt.as_bytes()).await?;
            pipe.shutdown().await?;
        }
        child.wait_with_output().await
    };

    // A timeout of zero means no limit.
    let output = if provider.timeout_secs == 0 {
        work.await?
    } else {
        let limit = Duration::from_secs(provider.timeout_secs);
        match tokio::time::timeout(limit, work).await {
            Ok(result) => result?,
            Err(_) => {
                return Err(AppError::other(format!(
                    "{command} did not finish within {} seconds",
                    provider.timeout_secs
                )))
            }
        }
    };

    if !output.status.success() {
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_string());
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::other(format!(
            "{command} exited with {code}: {}",
            tail(err.trim(), 500)
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();

    match provider.json_path.as_deref().filter(|f| !f.is_empty()) {
        None => Ok(stdout),
        Some(field) => {
            let value: serde_json::Value = serde_json::from_str(&stdout)
                .map_err(|e| AppError::other(format!("{command} did not print JSON: {e}")))?;
            let found = value.get(field).ok_or_else(|| {
                AppError::other(format!("{command} output has no \"{field}\" field"))
            })?;
            found.as_str().map(str::to_string).ok_or_else(|| {
                AppError::other(format!("\"{field}\" in {command} output is not a string"))
            })
        }
    }
}

/// Pull the JSON payload out of model output that may carry a preamble or
/// trailing chatter. A fenced block wins, then a bare array or object.
pub fn extract_json_block(text: &str) -> Option<&str> {
    if let Some(block) = fenced(text, "```json") {
        return Some(block);
    }
    if let Some(block) = fenced(text, "```") {
        return Some(block);
    }
    bare(text)
}

/// The body of the first fence opened by `tag`, up to the next set of
/// backticks.
fn fenced<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = text.find(tag)?;
    let after_tag = open + tag.len();
    // Skip the rest of the opening line, which may hold an info string.
    let body_start = text[after_tag..].find('\n')? + after_tag + 1;
    let close = text[body_start..].find("```")? + body_start;
    Some(text[body_start..close].trim())
}

/// The first balanced `[...]` or `{...}`, ignoring brackets inside strings.
fn bare(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let start = bytes.iter().position(|b| *b == b'[' || *b == b'{')?;

    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (i, b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if *b == b'\\' {
                escaped = true;
            } else if *b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'[' | b'{' => depth += 1,
            b']' | b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn prompt_is_substituted_in_every_argument() {
        let (out, used) = substitute_args(
            &args(&["-p", "{prompt}", "--output-format", "json"]),
            "find the buried verbs",
        );
        assert!(used);
        assert_eq!(out[1], "find the buried verbs");
        assert_eq!(out[3], "json");
    }

    #[test]
    fn substitution_happens_inside_a_larger_argument() {
        let (out, used) = substitute_args(&args(&["--input=<{prompt}>"]), "abc");
        assert!(used);
        assert_eq!(out[0], "--input=<abc>");
    }

    #[test]
    fn no_placeholder_means_stdin() {
        let (out, used) = substitute_args(&args(&["-p", "json"]), "abc");
        assert!(!used);
        assert_eq!(out, args(&["-p", "json"]));

        let (empty, used) = substitute_args(&[], "abc");
        assert!(!used);
        assert!(empty.is_empty());
    }

    #[test]
    fn a_json_fence_wins() {
        let text =
            "Here is what I found.\n\n```json\n[{\"quote\": \"a\"}]\n```\n\nHope that helps.";
        assert_eq!(extract_json_block(text).unwrap(), "[{\"quote\": \"a\"}]");
    }

    #[test]
    fn a_plain_fence_is_the_fallback() {
        let text = "preamble\n```\n{\"a\": 1}\n```\ntrailing";
        assert_eq!(extract_json_block(text).unwrap(), "{\"a\": 1}");
    }

    #[test]
    fn a_json_fence_is_preferred_over_an_earlier_plain_fence() {
        let text = "```\nnot json\n```\nand then\n```json\n[1, 2]\n```";
        assert_eq!(extract_json_block(text).unwrap(), "[1, 2]");
    }

    #[test]
    fn a_bare_array_is_found() {
        let text = "Findings:\n[{\"quote\": \"a\"}, {\"quote\": \"b\"}]\nThat is all.";
        assert_eq!(
            extract_json_block(text).unwrap(),
            "[{\"quote\": \"a\"}, {\"quote\": \"b\"}]"
        );
    }

    #[test]
    fn nesting_is_balanced() {
        let text = "x [{\"a\": [1, {\"b\": 2}]}] y";
        assert_eq!(
            extract_json_block(text).unwrap(),
            "[{\"a\": [1, {\"b\": 2}]}]"
        );
    }

    #[test]
    fn brackets_inside_strings_are_ignored() {
        let text = r#"note: [{"quote": "a ] b [ c", "note": "he said \"] \\"}] done"#;
        let got = extract_json_block(text).unwrap();
        assert!(got.starts_with('['));
        assert!(got.ends_with(']'));
        serde_json::from_str::<serde_json::Value>(got).unwrap();
    }

    #[test]
    fn no_json_yields_none() {
        assert_eq!(extract_json_block("nothing to report"), None);
        assert_eq!(extract_json_block(""), None);
        // An opening bracket that never closes is not a payload.
        assert_eq!(extract_json_block("[{\"quote\": \"a\""), None);
    }

    /// A `cli` provider that runs `sh -c <script>`.
    fn sh(script: &str, extra: &[&str]) -> Provider {
        let mut a = vec!["-c".to_string(), script.to_string()];
        a.extend(extra.iter().map(|s| s.to_string()));
        Provider {
            kind: "cli".into(),
            command: Some("sh".into()),
            args: a,
            timeout_secs: 10,
            ..Provider::default()
        }
    }

    #[tokio::test]
    async fn a_wrong_kind_is_rejected() {
        let mut p = sh("echo hi", &[]);
        p.kind = "anthropic".into();
        let err = cli_run(p, "x".into()).await.unwrap_err();
        assert!(err.to_string().contains("kind \"cli\""));
    }

    #[tokio::test]
    async fn a_missing_command_is_rejected() {
        let p = Provider {
            kind: "cli".into(),
            ..Provider::default()
        };
        let err = cli_run(p, "x".into()).await.unwrap_err();
        assert!(err.to_string().contains("needs a command"));
    }

    #[tokio::test]
    async fn the_prompt_reaches_the_argument() {
        let p = sh("printf '%s' \"$1\"", &["sh", "{prompt}"]);
        let out = cli_run(p, "buried verbs".into()).await.unwrap();
        assert_eq!(out, "buried verbs");
    }

    #[tokio::test]
    async fn the_prompt_reaches_stdin_when_no_argument_takes_it() {
        let p = sh("cat", &[]);
        let out = cli_run(p, "buried verbs".into()).await.unwrap();
        assert_eq!(out, "buried verbs");
    }

    #[tokio::test]
    async fn a_non_zero_exit_reports_the_code_and_stderr() {
        let p = sh("echo 'no such model' >&2; exit 3", &[]);
        let err = cli_run(p, "x".into()).await.unwrap_err().to_string();
        assert!(err.contains("exited with 3"), "{err}");
        assert!(err.contains("no such model"), "{err}");
    }

    #[tokio::test]
    async fn a_slow_command_times_out() {
        let mut p = sh("sleep 30", &[]);
        p.timeout_secs = 1;
        let err = cli_run(p, "x".into()).await.unwrap_err().to_string();
        assert!(err.contains("did not finish within 1 seconds"), "{err}");
    }

    #[tokio::test]
    async fn json_path_takes_the_named_field() {
        let mut p = sh(r#"printf '{"result": "the text", "cost": 1}'"#, &[]);
        p.json_path = Some("result".into());
        assert_eq!(cli_run(p, "x".into()).await.unwrap(), "the text");
    }

    #[tokio::test]
    async fn a_missing_json_field_is_an_error_naming_it() {
        let mut p = sh(r#"printf '{"cost": 1}'"#, &[]);
        p.json_path = Some("result".into());
        let err = cli_run(p, "x".into()).await.unwrap_err().to_string();
        assert!(err.contains("\"result\" field"), "{err}");
    }

    #[tokio::test]
    async fn output_that_is_not_json_is_an_error() {
        let mut p = sh("printf 'plain text'", &[]);
        p.json_path = Some("result".into());
        let err = cli_run(p, "x".into()).await.unwrap_err().to_string();
        assert!(err.contains("did not print JSON"), "{err}");
    }

    #[test]
    fn tail_keeps_the_end() {
        assert_eq!(tail("short", 500), "short");
        let long = "x".repeat(600);
        assert_eq!(tail(&long, 500).chars().count(), 500);
        // Multi-byte characters are counted as characters, not bytes.
        let accents = "é".repeat(10);
        assert_eq!(tail(&accents, 3), "ééé");
    }
}
