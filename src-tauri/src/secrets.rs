//! API keys. They live in the macOS keychain, or in the environment for keys
//! the user already exports. Nothing here can list what is stored: a caller
//! must name the exact reference it wants.

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
            Ok(std::env::var(name).ok().filter(|v| !v.is_empty()))
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
