//! API keys. They live in the macOS keychain, or in the environment for keys
//! the user already exports. Nothing here can list what is stored: a caller
//! must name the exact reference it wants.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Resolve a `key_ref` from `config.toml` to a key.
///
/// `env:NAME` reads the environment. `keychain:service/account` reads the
/// keychain. A reference that points at nothing yields `Ok(None)`, because a
/// key the user has not set yet is an ordinary state, not a failure. Only a
/// scheme the app does not understand is an error.
pub fn resolve_key(key_ref: Option<&str>) -> AppResult<Option<String>> {
    let raw = match key_ref {
        Some(s) => s.trim(),
        None => return Ok(None),
    };
    if raw.is_empty() {
        return Ok(None);
    }

    let (scheme, rest) = raw
        .split_once(':')
        .ok_or_else(|| AppError::invalid(format!("key_ref has no scheme: {raw}")))?;

    match scheme {
        "env" => {
            let name = rest.trim();
            if name.is_empty() {
                return Err(AppError::invalid("env: key_ref names no variable"));
            }
            Ok(env_value(name))
        }
        "keychain" => {
            let (service, account) = rest.split_once('/').ok_or_else(|| {
                AppError::invalid(format!(
                    "keychain key_ref must be keychain:service/account, got: {raw}"
                ))
            })?;
            if service.is_empty() || account.is_empty() {
                return Err(AppError::invalid(format!(
                    "keychain key_ref must be keychain:service/account, got: {raw}"
                )));
            }
            match keyring::Entry::new(service, account) {
                Ok(entry) => match entry.get_password() {
                    Ok(v) => Ok(Some(v)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(e) => Err(e.into()),
                },
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.into()),
            }
        }
        other => Err(AppError::invalid(format!(
            "unknown key_ref scheme '{other}'; use env: or keychain:"
        ))),
    }
}

/// The process environment first, then a `.env` file.
///
/// A desktop app launched from Finder inherits almost nothing, so an exported
/// variable is not a reliable way to hand the app a key. A `.env` file is.
fn env_value(name: &str) -> Option<String> {
    if let Ok(v) = std::env::var(name) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    for dir in env_file_dirs() {
        if let Some(v) = read_env_file(&dir.join(".env"), name) {
            return Some(v);
        }
    }
    None
}

/// Where a `.env` may sit: the writegood home first, then the working
/// directory and its parents, so a checkout's own `.env` is picked up during
/// development.
fn env_file_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    // Under test the home is only consulted when the override is set, so the
    // suite never reads a real `~/.writegood/.env`.
    if cfg!(not(test)) || std::env::var_os("WRITEGOOD_HOME").is_some() {
        dirs.push(crate::config::home_dir());
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut here = Some(cwd.as_path());
        for _ in 0..4 {
            match here {
                Some(d) => {
                    dirs.push(d.to_path_buf());
                    here = d.parent();
                }
                None => break,
            }
        }
    }
    dirs
}

/// A deliberately small `.env` reader: `NAME=value`, `#` comments, optional
/// `export `, optional surrounding quotes. No interpolation, no multi-line
/// values. Anything more would be a config language nobody asked for.
fn read_env_file(path: &Path, want: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let (name, value) = match line.split_once('=') {
            Some(pair) => pair,
            None => continue,
        };
        if name.trim() != want {
            continue;
        }
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        if value.is_empty() {
            return None;
        }
        return Some(value.to_string());
    }
    None
}

#[tauri::command]
pub fn secret_set(service: String, account: String, value: String) -> AppResult<()> {
    keyring::Entry::new(&service, &account)?.set_password(&value)?;
    Ok(())
}

#[tauri::command]
pub fn secret_delete(service: String, account: String) -> AppResult<()> {
    match keyring::Entry::new(&service, &account) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        },
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn secret_has(service: String, account: String) -> AppResult<bool> {
    match keyring::Entry::new(&service, &account) {
        Ok(entry) => match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(e.into()),
        },
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// How the frontend gets a key to hand to the AI SDK.
#[tauri::command]
pub fn key_resolve(key_ref: Option<String>) -> AppResult<Option<String>> {
    resolve_key(key_ref.as_deref())
}

#[cfg(test)]
mod tests {
    use super::read_env_file;

    /// Each test gets its own directory; they run in parallel in one process.
    fn env_file(tag: &str, body: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("writegood-env-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(".env");
        std::fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn reads_a_plain_assignment_from_a_dot_env() {
        let p = env_file("plain", "FOO=bar\nBAZ=qux\n");
        assert_eq!(read_env_file(&p, "BAZ").as_deref(), Some("qux"));
    }

    #[test]
    fn ignores_comments_and_blank_lines() {
        let p = env_file("comments", "# a comment\n\n  FOO = spaced \n");
        assert_eq!(read_env_file(&p, "FOO").as_deref(), Some("spaced"));
    }

    #[test]
    fn strips_export_and_quotes() {
        let p = env_file("quotes", "export FOO=\"quoted value\"\n");
        assert_eq!(read_env_file(&p, "FOO").as_deref(), Some("quoted value"));
    }

    #[test]
    fn an_absent_name_or_file_yields_nothing() {
        let p = env_file("absent", "FOO=bar\n");
        assert_eq!(read_env_file(&p, "MISSING"), None);
        assert_eq!(
            read_env_file(std::path::Path::new("/nope/.env"), "FOO"),
            None
        );
    }

    #[test]
    fn an_empty_value_counts_as_unset() {
        let p = env_file("empty", "FOO=\n");
        assert_eq!(read_env_file(&p, "FOO"), None);
    }

    use super::*;

    // The keychain itself is not tested; reading it prompts for permission.

    #[test]
    fn no_ref_resolves_to_nothing() {
        assert_eq!(resolve_key(None).unwrap(), None);
        assert_eq!(resolve_key(Some("")).unwrap(), None);
        assert_eq!(resolve_key(Some("   ")).unwrap(), None);
    }

    #[test]
    fn env_refs_read_the_environment() {
        let name = "WRITEGOOD_TEST_KEY_PRESENT";
        std::env::set_var(name, "sk-test");
        assert_eq!(
            resolve_key(Some("env:WRITEGOOD_TEST_KEY_PRESENT")).unwrap(),
            Some("sk-test".to_string())
        );
        std::env::remove_var(name);
    }

    #[test]
    fn a_missing_env_var_is_not_an_error() {
        assert_eq!(
            resolve_key(Some("env:WRITEGOOD_TEST_KEY_ABSENT")).unwrap(),
            None
        );
    }

    #[test]
    fn an_empty_env_var_counts_as_missing() {
        let name = "WRITEGOOD_TEST_KEY_EMPTY";
        std::env::set_var(name, "");
        assert_eq!(
            resolve_key(Some("env:WRITEGOOD_TEST_KEY_EMPTY")).unwrap(),
            None
        );
        std::env::remove_var(name);
    }

    #[test]
    fn an_unknown_scheme_is_an_error() {
        let err = resolve_key(Some("vault:writegood/anthropic")).unwrap_err();
        assert!(err.to_string().contains("unknown key_ref scheme 'vault'"));
    }

    #[test]
    fn a_ref_without_a_scheme_is_an_error() {
        let err = resolve_key(Some("OPENAI_API_KEY")).unwrap_err();
        assert!(err.to_string().contains("no scheme"));
    }

    #[test]
    fn a_keychain_ref_without_an_account_is_an_error() {
        let err = resolve_key(Some("keychain:writegood")).unwrap_err();
        assert!(err.to_string().contains("keychain:service/account"));
    }

    #[test]
    fn an_env_ref_without_a_name_is_an_error() {
        let err = resolve_key(Some("env:")).unwrap_err();
        assert!(err.to_string().contains("names no variable"));
    }
}
