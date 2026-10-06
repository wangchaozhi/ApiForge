use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum AppError {
    #[error("invalid HTTP method: {0}")]
    InvalidMethod(String),
    #[error("invalid header name: {0}")]
    InvalidHeaderName(String),
    #[error("invalid header value for {0}")]
    InvalidHeaderValue(String),
    #[error("request cancelled")]
    Cancelled,
    #[error("request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("path error: {0}")]
    Path(#[from] tauri::Error),
    #[error("database lock is poisoned")]
    DatabaseLock,
    #[error("cookie store lock is poisoned")]
    CookieLock,
    #[error("cookie persistence error: {0}")]
    CookiePersistence(String),
    #[error("request cancellation lock is poisoned")]
    CancellationLock,
    #[error("authentication error: {0}")]
    Authentication(String),
    #[error("protocol error: {0}")]
    Protocol(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
