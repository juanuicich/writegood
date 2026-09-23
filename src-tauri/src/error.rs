//! One error type across the Rust side. Tauri commands return it as a string,
//! because the frontend can only show a message anyway.

use serde::{Serialize, Serializer};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("no such {0}")]
    NotFound(&'static str),

    #[error("{0}")]
    Invalid(String),

    #[error("database: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("file: {0}")]
    Io(#[from] std::io::Error),

    #[error("config: {0}")]
    Toml(#[from] toml::de::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("keychain: {0}")]
    Keyring(#[from] keyring::Error),

    /// The provider refused the call's credentials: HTTP 401 or 403.
    #[error("{0}")]
    Refused(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl AppError {
    pub fn invalid(msg: impl Into<String>) -> Self {
        AppError::Invalid(msg.into())
    }

    pub fn other(msg: impl Into<String>) -> Self {
        AppError::Other(msg.into())
    }

    /// Whether every call of a pass would fail the same way (SPEC §8.3): a
    /// bad config, a missing key or model, a key the keychain will not give,
    /// or a key the provider refused. Any other failure belongs to its call.
    pub fn fails_every_call(&self) -> bool {
        matches!(
            self,
            AppError::NotFound(_)
                | AppError::Invalid(_)
                | AppError::Toml(_)
                | AppError::Keyring(_)
                | AppError::Refused(_)
        )
    }
}

/// A failed model call, as the frontend receives it (SPEC §8.3). A pass
/// stops when `whole_pass` is set. Otherwise only this call fails, and the
/// next run asks it again.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallError {
    pub message: String,
    pub whole_pass: bool,
}

impl From<AppError> for CallError {
    fn from(e: AppError) -> Self {
        CallError {
            whole_pass: e.fails_every_call(),
            message: e.to_string(),
        }
    }
}
