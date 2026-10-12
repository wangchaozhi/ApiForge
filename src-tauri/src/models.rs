use serde::{Deserialize, Serialize};

pub(crate) use apiforge_engine::models::{
    EngineField, EngineRequest, EngineResponse, NetworkSettings,
};

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
