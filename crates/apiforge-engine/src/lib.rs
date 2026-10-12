//! ApiForge request engine.
//!
//! Shared by the Tauri desktop backend (`src-tauri`) and the web agent (`agent`), so both
//! execute requests with the same body encoding, digest auth, TLS, proxy and redirect rules.

pub mod digest;
pub mod error;
pub mod http;
pub mod models;
pub mod policy;

pub use error::EngineError;
pub use http::execute_request;
pub use policy::ExecutionPolicy;

/// Re-exported so callers share the exact cookie store type the engine accepts.
pub use reqwest_cookie_store;
