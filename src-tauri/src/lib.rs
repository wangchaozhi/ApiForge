use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::{
    Client, Method, Proxy,
    header::{HeaderMap, HeaderName, HeaderValue},
    multipart,
    redirect::Policy,
};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use thiserror::Error;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineRequest {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: EngineBody,
    network: NetworkSettings,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum EngineBody {
    None,
    Text { content: String },
    Urlencoded { fields: Vec<EngineField> },
    Multipart { fields: Vec<EngineMultipartField> },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineField {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineMultipartField {
    key: String,
    value: String,
    kind: String,
    #[allow(dead_code)]
    file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkSettings {
    timeout_ms: u64,
    follow_redirects: bool,
    verify_tls: bool,
    cookies_enabled: bool,
    use_system_proxy: bool,
    proxy_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineResponse {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
    body_encoding: String,
    elapsed_ms: u128,
    size_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CookieInfo {
    domain: String,
    path: String,
    name: String,
    value: String,
    secure: bool,
    http_only: bool,
    expires: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    id: String,
    request_id: String,
    request_name: String,
    method: String,
    url: String,
    status: u16,
    status_text: String,
    elapsed_ms: u128,
    size_bytes: usize,
    request_json: String,
    response_json: String,
    created_at: String,
}

struct Database {
    connection: Mutex<Connection>,
}

struct HttpState {
    cookie_jar: Arc<CookieStoreMutex>,
    cookie_path: PathBuf,
    cancellations: Mutex<HashMap<String, CancellationToken>>,
}

impl HttpState {
    fn open(app: &tauri::App) -> Result<Self, AppError> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let cookie_path = data_dir.join("cookies.json");
        let cookie_store = if cookie_path.exists() {
            File::open(&cookie_path)
                .ok()
                .and_then(|file| cookie_store::serde::json::load(BufReader::new(file)).ok())
                .unwrap_or_else(CookieStore::new)
        } else {
            CookieStore::new()
        };
        Ok(Self {
            cookie_jar: Arc::new(CookieStoreMutex::new(cookie_store)),
            cookie_path,
            cancellations: Mutex::new(HashMap::new()),
        })
    }
}

fn persist_cookie_store(store: &CookieStore, path: &Path) -> Result<(), AppError> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    cookie_store::serde::json::save_incl_expired_and_nonpersistent(store, &mut writer)
        .map_err(|error| AppError::CookiePersistence(error.to_string()))?;
    writer.flush()?;
    Ok(())
}

fn is_textual_content_type(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.trim().is_empty()
        || value.starts_with("text/")
        || value.contains("json")
        || value.contains("xml")
        || value.contains("javascript")
        || value.contains("x-www-form-urlencoded")
        || value.contains("svg")
}

#[derive(Debug, Error)]
enum AppError {
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
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl Database {
    fn open(app: &tauri::App) -> Result<Self, AppError> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let connection = Connection::open(data_dir.join("apiforge.sqlite3"))?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL,
                request_name TEXT NOT NULL,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                status INTEGER NOT NULL,
                status_text TEXT NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL,
                request_json TEXT NOT NULL,
                response_json TEXT NOT NULL,
                created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
}

async fn execute_request(
    request: EngineRequest,
    cookie_jar: Arc<CookieStoreMutex>,
    cookie_path: PathBuf,
) -> Result<EngineResponse, AppError> {
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|_| AppError::InvalidMethod(request.method.clone()))?;

    let mut headers = HeaderMap::new();
    for (name, value) in request.headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| AppError::InvalidHeaderName(name.clone()))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|_| AppError::InvalidHeaderValue(name.clone()))?;
        headers.insert(header_name, header_value);
    }

    let mut client_builder = Client::builder()
        .redirect(if request.network.follow_redirects {
            Policy::limited(10)
        } else {
            Policy::none()
        })
        .timeout(Duration::from_millis(request.network.timeout_ms.max(1)))
        .tls_danger_accept_invalid_certs(!request.network.verify_tls)
        .user_agent(concat!("ApiForge/", env!("CARGO_PKG_VERSION")));

    if request.network.cookies_enabled {
        client_builder = client_builder.cookie_provider(Arc::clone(&cookie_jar));
    }

    let proxy_url = request.network.proxy_url.trim();
    if !proxy_url.is_empty() {
        client_builder = client_builder.proxy(Proxy::all(proxy_url)?);
    } else if !request.network.use_system_proxy {
        client_builder = client_builder.no_proxy();
    }

    let client = client_builder.build()?;
    let started = Instant::now();
    let mut builder = client.request(method, &request.url).headers(headers);

    builder = match request.body {
        EngineBody::None => builder,
        EngineBody::Text { content } => builder.body(content),
        EngineBody::Urlencoded { fields } => {
            let pairs = fields
                .into_iter()
                .map(|field| (field.key, field.value))
                .collect::<Vec<_>>();
            builder.form(&pairs)
        }
        EngineBody::Multipart { fields } => {
            let mut form = multipart::Form::new();
            for field in fields {
                if field.kind == "file" {
                    if !field.value.trim().is_empty() {
                        form = form.file(field.key, field.value).await?;
                    }
                } else {
                    form = form.text(field.key, field.value);
                }
            }
            builder.multipart(form)
        }
    };

    let response = builder.send().await?;
    let status = response.status();
    let response_headers = response
        .headers()
        .iter()
        .map(|(key, value)| {
            (
                key.as_str().to_string(),
                value.to_str().unwrap_or("<binary header>").to_string(),
            )
        })
        .collect::<HashMap<_, _>>();

    let content_type = response_headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| value.as_str())
        .unwrap_or("");
    let bytes = response.bytes().await?;
    let size_bytes = bytes.len();
    let (body, body_encoding) = if is_textual_content_type(content_type) {
        (
            String::from_utf8_lossy(&bytes).into_owned(),
            "utf8".to_string(),
        )
    } else {
        (BASE64_STANDARD.encode(&bytes), "base64".to_string())
    };

    if request.network.cookies_enabled {
        let store = cookie_jar.lock().map_err(|_| AppError::CookieLock)?;
        persist_cookie_store(&store, &cookie_path)?;
    }

    Ok(EngineResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers: response_headers,
        body,
        body_encoding,
        elapsed_ms: started.elapsed().as_millis(),
        size_bytes,
    })
}

#[tauri::command]
async fn send_request(
    operation_id: String,
    request: EngineRequest,
    http_state: State<'_, HttpState>,
) -> Result<EngineResponse, AppError> {
    let token = CancellationToken::new();
    {
        let mut cancellations = http_state
            .cancellations
            .lock()
            .map_err(|_| AppError::CancellationLock)?;
        cancellations.insert(operation_id.clone(), token.clone());
    }

    let cookie_jar = Arc::clone(&http_state.cookie_jar);
    let cookie_path = http_state.cookie_path.clone();
    let result = tokio::select! {
        _ = token.cancelled() => Err(AppError::Cancelled),
        result = execute_request(request, cookie_jar, cookie_path) => result,
    };

    let mut cancellations = http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?;
    cancellations.remove(&operation_id);
    result
}

#[tauri::command]
fn cancel_request(operation_id: String, http_state: State<'_, HttpState>) -> Result<(), AppError> {
    let cancellations = http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?;
    if let Some(token) = cancellations.get(&operation_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
fn clear_cookie_jar(http_state: State<'_, HttpState>) -> Result<(), AppError> {
    let mut store = http_state
        .cookie_jar
        .lock()
        .map_err(|_| AppError::CookieLock)?;
    store.clear();
    persist_cookie_store(&store, &http_state.cookie_path)
}

#[tauri::command]
fn list_cookies(http_state: State<'_, HttpState>) -> Result<Vec<CookieInfo>, AppError> {
    let store = http_state
        .cookie_jar
        .lock()
        .map_err(|_| AppError::CookieLock)?;
    let mut cookies = store
        .iter_unexpired()
        .map(|cookie| CookieInfo {
            domain: cookie
                .domain
                .as_cow()
                .map(|value| value.into_owned())
                .unwrap_or_default(),
            path: cookie.path.as_ref().to_owned(),
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            secure: cookie.secure().unwrap_or(false),
            http_only: cookie.http_only().unwrap_or(false),
            expires: cookie.expires_datetime().map(|value| value.to_string()),
        })
        .collect::<Vec<_>>();
    cookies.sort_by(|a, b| (&a.domain, &a.path, &a.name).cmp(&(&b.domain, &b.path, &b.name)));
    Ok(cookies)
}

#[tauri::command]
fn remove_cookie(
    domain: String,
    path: String,
    name: String,
    http_state: State<'_, HttpState>,
) -> Result<(), AppError> {
    let mut store = http_state
        .cookie_jar
        .lock()
        .map_err(|_| AppError::CookieLock)?;
    store.remove(&domain, &path, &name);
    persist_cookie_store(&store, &http_state.cookie_path)
}

#[tauri::command]
fn save_history(entry: HistoryEntry, database: State<'_, Database>) -> Result<(), AppError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| AppError::DatabaseLock)?;
    connection.execute(
        "INSERT OR REPLACE INTO history (
            id, request_id, request_name, method, url, status, status_text,
            elapsed_ms, size_bytes, request_json, response_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            entry.id,
            entry.request_id,
            entry.request_name,
            entry.method,
            entry.url,
            entry.status,
            entry.status_text,
            entry.elapsed_ms as i64,
            entry.size_bytes as i64,
            entry.request_json,
            entry.response_json,
            entry.created_at,
        ],
    )?;
    connection.execute(
        "DELETE FROM history WHERE id NOT IN (
            SELECT id FROM history ORDER BY created_at DESC LIMIT 500
         )",
        [],
    )?;
    Ok(())
}

#[tauri::command]
fn list_history(
    limit: Option<u32>,
    database: State<'_, Database>,
) -> Result<Vec<HistoryEntry>, AppError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| AppError::DatabaseLock)?;
    let limit = limit.unwrap_or(200).clamp(1, 500);
    let limit_i64 = limit as i64;
    let mut statement = connection.prepare(
        "SELECT id, request_id, request_name, method, url, status, status_text,
                elapsed_ms, size_bytes, request_json, response_json, created_at
         FROM history
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;

    let rows = statement.query_map([limit_i64], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            request_id: row.get(1)?,
            request_name: row.get(2)?,
            method: row.get(3)?,
            url: row.get(4)?,
            status: row.get(5)?,
            status_text: row.get(6)?,
            elapsed_ms: row.get::<_, i64>(7)? as u128,
            size_bytes: row.get::<_, i64>(8)? as usize,
            request_json: row.get(9)?,
            response_json: row.get(10)?,
            created_at: row.get(11)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

#[tauri::command]
fn clear_history(database: State<'_, Database>) -> Result<(), AppError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| AppError::DatabaseLock)?;
    connection.execute("DELETE FROM history", [])?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let local_data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&local_data_dir)?;
            let stronghold_salt = local_data_dir.join("stronghold-salt.bin");
            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(&stronghold_salt).build(),
            )?;

            let database = Database::open(app)?;
            app.manage(database);
            app.manage(HttpState::open(app)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_request,
            cancel_request,
            clear_cookie_jar,
            list_cookies,
            remove_cookie,
            save_history,
            list_history,
            clear_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running ApiForge");
}


#[cfg(test)]
mod tests {
    use super::is_textual_content_type;

    #[test]
    fn classifies_textual_response_types() {
        for content_type in [
            "",
            "text/plain; charset=utf-8",
            "application/json",
            "application/problem+json",
            "application/xml",
            "application/javascript",
            "application/x-www-form-urlencoded",
            "image/svg+xml",
        ] {
            assert!(is_textual_content_type(content_type), "expected textual: {content_type}");
        }
    }

    #[test]
    fn classifies_binary_response_types() {
        for content_type in [
            "application/pdf",
            "application/octet-stream",
            "image/png",
            "image/jpeg",
            "audio/mpeg",
            "video/mp4",
        ] {
            assert!(!is_textual_content_type(content_type), "expected binary: {content_type}");
        }
    }
}
