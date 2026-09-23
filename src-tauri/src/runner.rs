//! The CLI provider backend. It runs `claude`, `codex` or anything else that
//! takes a prompt and prints an answer, so passes can bill against a
//! subscription instead of API credits.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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

/// Replace `{workdir}`, `{model}` and `{thinking}` in every argument. A
/// placeholder whose value is not set is an error that names the key. Runs
/// before `substitute_args`, so a prompt that contains one of these words is
/// passed on as written.
pub fn fill_placeholders(
    args: &[String],
    values: &[(&str, Option<&str>)],
) -> AppResult<Vec<String>> {
    args.iter()
        .map(|a| {
            let mut out = a.clone();
            for (name, value) in values {
                let tag = format!("{{{name}}}");
                if !out.contains(&tag) {
                    continue;
                }
                let v = value.ok_or_else(|| {
                    AppError::invalid(format!(
                        "the args use {tag}, but the provider sets no {name}"
                    ))
                })?;
                out = out.replace(&tag, v);
            }
            Ok(out)
        })
        .collect()
}

/// An empty directory for one call, deleted when it is dropped. A command
/// that is an agent reads its working directory, so it must find nothing of
/// the author's there (SPEC §9.3).
struct Workdir(PathBuf);

impl Workdir {
    fn new() -> AppResult<Self> {
        static COUNT: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let name = format!(
            "writegood-cli-{}-{nanos}-{}",
            std::process::id(),
            COUNT.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(name);
        // create_dir, not create_dir_all: a directory that already exists is
        // not empty, and is an error.
        std::fs::create_dir(&path)
            .map_err(|e| AppError::other(format!("cannot create a working directory: {e}")))?;
        Ok(Workdir(path))
    }

    /// Write the provider's files. A path must be relative and stay inside.
    fn write(&self, files: &BTreeMap<String, String>) -> AppResult<()> {
        for (rel, text) in files {
            let path = Path::new(rel);
            let inside = !rel.is_empty()
                && path
                    .components()
                    .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
            if !inside {
                return Err(AppError::invalid(format!(
                    "files: \"{rel}\" must be a relative path inside the working directory"
                )));
            }
            let target = self.0.join(path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&target, text)?;
        }
        Ok(())
    }
}

impl Drop for Workdir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The text `{thinking}` becomes: the level's entry in `thinking_names`,
/// else the level as written. agy has no `-off` or `-max` model, so its
/// config maps them to `low` and `high` (SPEC §9.3).
fn thinking_name(provider: &Provider) -> Option<&str> {
    let level = provider.thinking.as_deref()?;
    Some(
        provider
            .thinking_names
            .get(level)
            .map(String::as_str)
            .unwrap_or(level),
    )
}

/// True when a JSON value reports an error: anything but null, false or an
/// empty string.
fn is_error(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => !s.trim().is_empty(),
        _ => true,
    }
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

    // Dropped when this function returns, which deletes the directory.
    let workdir = Workdir::new()?;
    workdir.write(&provider.files)?;
    let dir = workdir.0.to_string_lossy().into_owned();
    let filled = fill_placeholders(
        &provider.args,
        &[
            ("workdir", Some(dir.as_str())),
            ("model", provider.model.as_deref()),
            ("thinking", thinking_name(&provider)),
        ],
    )?;
    let (args, prompt_in_args) = substitute_args(&filled, &prompt);

    let mut cmd = tokio::process::Command::new(&command);
    cmd.args(&args)
        .current_dir(&workdir.0)
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

    let error_field = provider.json_error.as_deref().filter(|f| !f.is_empty());
    let json_path = provider.json_path.as_deref().filter(|f| !f.is_empty());
    if error_field.is_none() && json_path.is_none() {
        return Ok(stdout);
    }
    let value: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| AppError::other(format!("{command} did not print JSON: {e}")))?;

    // Some commands exit with 0 and report the failure in their JSON; agy
    // does this for a rate limit (SPEC §9.3).
    if let Some(field) = error_field {
        if let Some(err) = value.get(field).filter(|v| is_error(v)) {
            let text = err
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| err.to_string());
            return Err(AppError::other(format!(
                "{command} reported an error: {}",
                tail(text.trim(), 500)
            )));
        }
    }

    match json_path {
        None => Ok(stdout),
        Some(field) => {
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

    #[tokio::test]
    async fn the_command_runs_in_an_empty_directory_that_is_deleted_after() {
        let p = sh("pwd -P; ls -A | wc -l", &[]);
        let out = cli_run(p, "x".into()).await.unwrap();
        let mut lines = out.lines();
        let dir = lines.next().unwrap().to_string();
        assert!(dir.contains("writegood-cli-"), "{dir}");
        assert_eq!(lines.next().unwrap().trim(), "0");
        assert!(!Path::new(&dir).exists(), "{dir} was not deleted");
    }

    #[tokio::test]
    async fn two_calls_get_two_directories() {
        let a = cli_run(sh("pwd", &[]), "x".into()).await.unwrap();
        let b = cli_run(sh("pwd", &[]), "x".into()).await.unwrap();
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn the_provider_files_are_written_before_the_command_starts() {
        let mut p = sh("cat .agents/agents/writegood/agent.md .agents/hooks.json", &[]);
        p.files.insert(".agents/agents/writegood/agent.md".into(), "tools: []\n".into());
        p.files.insert(".agents/hooks.json".into(), "{}".into());
        assert_eq!(cli_run(p, "x".into()).await.unwrap(), "tools: []\n{}");
    }

    #[tokio::test]
    async fn a_file_outside_the_directory_is_rejected() {
        for bad in ["../escape", "/tmp/escape", "a/../../escape", ""] {
            let mut p = sh("true", &[]);
            p.files.insert(bad.into(), "x".into());
            let err = cli_run(p, "x".into()).await.unwrap_err().to_string();
            assert!(err.contains("relative path inside"), "{bad}: {err}");
        }
    }

    #[tokio::test]
    async fn workdir_model_and_thinking_reach_the_arguments() {
        let mut p = sh(
            "[ \"$(cd \"$1\" && pwd -P)\" = \"$(pwd -P)\" ] && printf '%s %s' \"$2\" \"$3\"",
            &["sh", "{workdir}", "--model={model}-{thinking}", "{prompt}"],
        );
        p.model = Some("gemini-3.8-flash".into());
        p.thinking = Some("high".into());
        let out = cli_run(p, "the prompt".into()).await.unwrap();
        assert_eq!(out, "--model=gemini-3.8-flash-high the prompt");
    }

    #[tokio::test]
    async fn thinking_names_rename_a_level_and_leave_the_others() {
        for (level, expected) in [
            ("off", "low"),
            ("max", "high"),
            ("low", "low"),
            ("high", "high"),
        ] {
            let mut p = sh("printf '%s' \"$1\"", &["sh", "--model={model}-{thinking}"]);
            p.model = Some("gemini-3.8-flash".into());
            p.thinking = Some(level.into());
            p.thinking_names.insert("off".into(), "low".into());
            p.thinking_names.insert("max".into(), "high".into());
            let out = cli_run(p, "x".into()).await.unwrap();
            assert_eq!(
                out,
                format!("--model=gemini-3.8-flash-{expected}"),
                "{level}"
            );
        }
    }

    #[tokio::test]
    async fn a_placeholder_without_a_value_names_the_missing_key() {
        let mut p = sh("true", &["sh", "--model={model}-{thinking}"]);
        p.model = Some("gemini-3.8-flash".into());
        let err = cli_run(p, "x".into()).await.unwrap_err().to_string();
        assert!(err.contains("{thinking}"), "{err}");
        assert!(err.contains("no thinking"), "{err}");
    }

    #[test]
    fn a_prompt_that_contains_a_placeholder_is_passed_on_as_written() {
        let filled = fill_placeholders(
            &args(&["{prompt}", "{model}"]),
            &[("model", Some("m"))],
        )
        .unwrap();
        let (out, _) = substitute_args(&filled, "write {model} here");
        assert_eq!(out, args(&["write {model} here", "m"]));
    }

    #[tokio::test]
    async fn json_error_fails_the_call_even_with_exit_code_zero() {
        // What agy printed for a rate limit: status ERROR, exit code 0, and a
        // response that looks like an empty answer.
        let mut p = sh(
            r#"printf '{"status": "ERROR", "response": "[]", "error": "RESOURCE_EXHAUSTED (code 429)"}'"#,
            &[],
        );
        p.json_path = Some("response".into());
        p.json_error = Some("error".into());
        let err = cli_run(p, "x".into()).await.unwrap_err().to_string();
        assert!(err.contains("reported an error"), "{err}");
        assert!(err.contains("RESOURCE_EXHAUSTED"), "{err}");
    }

    #[tokio::test]
    async fn json_error_passes_when_the_field_is_absent_null_false_or_empty() {
        for body in [
            r#"{"response": "[]"}"#,
            r#"{"response": "[]", "error": null}"#,
            r#"{"response": "[]", "error": false}"#,
            r#"{"response": "[]", "error": ""}"#,
        ] {
            let mut p = sh(&format!("printf '%s' '{body}'"), &[]);
            p.json_path = Some("response".into());
            p.json_error = Some("error".into());
            assert_eq!(cli_run(p, "x".into()).await.unwrap(), "[]", "{body}");
        }
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
