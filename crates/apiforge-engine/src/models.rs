//! Request/response contracts shared by the Tauri IPC layer and the web agent.
//! Field names serialize as camelCase to match `src/domain/engine.ts`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: EngineBody,
    pub network: NetworkSettings,
    pub digest_auth: Option<DigestCredentials>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineBody {
    None,
    Text { content: String },
    Urlencoded { fields: Vec<EngineField> },
    Multipart { fields: Vec<EngineMultipartField> },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineField {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineMultipartField {
    pub key: String,
    pub value: String,
    pub kind: String,
    pub file_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub verify_tls: bool,
    pub cookies_enabled: bool,
    pub use_system_proxy: bool,
    pub proxy_url: String,
    pub proxy_username: String,
    pub proxy_password: String,
    pub client_certificate_type: String,
    pub client_certificate_path: String,
    pub client_key_path: String,
    pub client_certificate_password: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestCredentials {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub body_encoding: String,
    pub elapsed_ms: u128,
    pub size_bytes: usize,
}
