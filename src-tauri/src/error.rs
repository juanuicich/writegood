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
}
