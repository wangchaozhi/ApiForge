use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineRequest {
    pub(crate) method: String,
    pub(crate) url: String,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: EngineBody,
    pub(crate) network: NetworkSettings,
    pub(crate) digest_auth: Option<DigestCredentials>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum EngineBody {
    None,
    Text { content: String },
    Urlencoded { fields: Vec<EngineField> },
    Multipart { fields: Vec<EngineMultipartField> },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineField {
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineMultipartField {
    pub(crate) key: String,
    pub(crate) value: String,
    pub(crate) kind: String,
    #[allow(dead_code)]
    pub(crate) file_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkSettings {
    pub(crate) timeout_ms: u64,
    pub(crate) follow_redirects: bool,
    pub(crate) verify_tls: bool,
    pub(crate) cookies_enabled: bool,
    pub(crate) use_system_proxy: bool,
    pub(crate) proxy_url: String,
    pub(crate) proxy_username: String,
    pub(crate) proxy_password: String,
    pub(crate) client_certificate_type: String,
    pub(crate) client_certificate_path: String,
    pub(crate) client_key_path: String,
    pub(crate) client_certificate_password: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DigestCredentials {
    pub(crate) username: String,
    pub(crate) password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineResponse {
    pub(crate) status: u16,
    pub(crate) status_text: String,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: String,
    pub(crate) body_encoding: String,
    pub(crate) elapsed_ms: u128,
    pub(crate) size_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CookieInfo {
    pub(crate) domain: String,
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) secure: bool,
    pub(crate) http_only: bool,
    pub(crate) expires: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryEntry {
    pub(crate) id: String,
    pub(crate) request_id: String,
    pub(crate) request_name: String,
    pub(crate) method: String,
    pub(crate) url: String,
    pub(crate) status: u16,
    pub(crate) status_text: String,
    pub(crate) elapsed_ms: u128,
    pub(crate) size_bytes: usize,
    pub(crate) request_json: String,
    pub(crate) response_json: String,
    pub(crate) created_at: String,
}
