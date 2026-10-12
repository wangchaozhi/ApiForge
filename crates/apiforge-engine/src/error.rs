use std::error::Error as _;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("invalid HTTP method: {0}")]
    InvalidMethod(String),
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    #[error("invalid header name: {0}")]
    InvalidHeaderName(String),
    #[error("invalid header value for {0}")]
    InvalidHeaderValue(String),
    #[error("request failed: {}", describe_reqwest_error(.0))]
    Http(#[from] reqwest::Error),
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("authentication error: {0}")]
    Authentication(String),
    #[error("blocked by execution policy: {0}")]
    Policy(String),
    #[error("response body exceeds the {0}-byte limit")]
    ResponseTooLarge(usize),
}

/// reqwest's own Display hides the underlying cause ("error sending request").
/// Append the source chain so connect, DNS, TLS and policy failures stay visible.
fn describe_reqwest_error(error: &reqwest::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !text.is_empty() && !message.contains(&text) {
            message.push_str(": ");
            message.push_str(&text);
        }
        source = cause.source();
    }
    message
}
