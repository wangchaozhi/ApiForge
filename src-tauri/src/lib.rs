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
    Client, Identity, Method, Proxy, RequestBuilder, Response,
    header::{HeaderMap, HeaderName, HeaderValue, WWW_AUTHENTICATE},
    multipart,
    redirect::Policy,
};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use thiserror::Error;
use tokio_util::sync::CancellationToken;

mod sse;
use sse::start_sse;

mod websocket;
use websocket::{WebSocketState, send_websocket_message, start_websocket};

mod grpc;
use grpc::{inspect_grpc_descriptor, invoke_grpc};

mod history;
use history::{Database, clear_history, list_history, save_history};

mod digest;

mod script;
use script::run_script;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineRequest {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: EngineBody,
    network: NetworkSettings,
    digest_auth: Option<DigestCredentials>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum EngineBody {
    None,
    Text { content: String },
    Urlencoded { fields: Vec<EngineField> },
    Multipart { fields: Vec<EngineMultipartField> },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineField {
    key: String,
    value: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineMultipartField {
    key: String,
    value: String,
    kind: String,
    #[allow(dead_code)]
    file_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkSettings {
    timeout_ms: u64,
    follow_redirects: bool,
    verify_tls: bool,
    cookies_enabled: bool,
    use_system_proxy: bool,
    proxy_url: String,
    proxy_username: String,
    proxy_password: String,
    client_certificate_type: String,
    client_certificate_path: String,
    client_key_path: String,
    client_certificate_password: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DigestCredentials {
    username: String,
    password: String,
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

pub(crate) struct HttpState {
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

async fn apply_body(
    builder: RequestBuilder,
    body: &EngineBody,
) -> Result<RequestBuilder, AppError> {
    Ok(match body {
        EngineBody::None => builder,
        EngineBody::Text { content } => builder.body(content.clone()),
        EngineBody::Urlencoded { fields } => {
            let pairs = fields
                .iter()
                .map(|field| (field.key.clone(), field.value.clone()))
                .collect::<Vec<_>>();
            builder.form(&pairs)
        }
        EngineBody::Multipart { fields } => {
            let mut form = multipart::Form::new();
            for field in fields {
                if field.kind == "file" {
                    if !field.value.trim().is_empty() {
                        let mut part = multipart::Part::file(&field.value).await?;
                        if let Some(file_name) =
                            field.file_name.as_ref().filter(|name| !name.is_empty())
                        {
                            part = part.file_name(file_name.clone());
                        }
                        form = form.part(field.key.clone(), part);
                    }
                } else {
                    form = form.text(field.key.clone(), field.value.clone());
                }
            }
            builder.multipart(form)
        }
    })
}

fn load_client_identity(network: &NetworkSettings) -> Result<Option<Identity>, AppError> {
    let certificate_path = network.client_certificate_path.trim();
    match network.client_certificate_type.as_str() {
        "none" | "" => Ok(None),
        "pkcs12" => {
            let bytes = fs::read(certificate_path)?;
            Identity::from_pkcs12_der(&bytes, &network.client_certificate_password)
                .map(Some)
                .map_err(AppError::Http)
        }
        "pem" => {
            let mut pem = fs::read(certificate_path)?;
            let key_path = network.client_key_path.trim();
            if !key_path.is_empty() {
                pem.extend_from_slice(b"\n");
                pem.extend_from_slice(&fs::read(key_path)?);
            }
            Identity::from_pem(&pem).map(Some).map_err(AppError::Http)
        }
        other => Err(AppError::Authentication(format!(
            "unsupported client certificate type: {other}"
        ))),
    }
}

async fn send_with_optional_digest(
    client: &Client,
    method: &Method,
    url: &str,
    headers: &HeaderMap,
    body: &EngineBody,
    credentials: Option<&DigestCredentials>,
) -> Result<Response, AppError> {
    let first = apply_body(
        client.request(method.clone(), url).headers(headers.clone()),
        body,
    )
    .await?;
    let response = first.send().await?;
    let Some(credentials) = credentials else {
        return Ok(response);
    };
    if response.status() != reqwest::StatusCode::UNAUTHORIZED {
        return Ok(response);
    }
    let Some(challenge) = response
        .headers()
        .get(WWW_AUTHENTICATE)
        .and_then(|value| value.to_str().ok())
    else {
        return Ok(response);
    };
    if !challenge
        .trim_start()
        .to_ascii_lowercase()
        .starts_with("digest ")
    {
        return Ok(response);
    }
    let authorization = digest::authorization_header(
        challenge,
        method.as_str(),
        url,
        &credentials.username,
        &credentials.password,
    )
    .map_err(AppError::Authentication)?;
    drop(response);
    let second = client
        .request(method.clone(), url)
        .headers(headers.clone())
        .header(reqwest::header::AUTHORIZATION, authorization);
    Ok(apply_body(second, body).await?.send().await?)
}

async fn execute_request(
    request: EngineRequest,
    cookie_jar: Arc<CookieStoreMutex>,
    cookie_path: PathBuf,
) -> Result<EngineResponse, AppError> {
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|_| AppError::InvalidMethod(request.method.clone()))?;

    let mut headers = HeaderMap::new();
    for (name, value) in &request.headers {
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
        let mut proxy = Proxy::all(proxy_url)?;
        if !request.network.proxy_username.is_empty() {
            proxy = proxy.basic_auth(
                &request.network.proxy_username,
                &request.network.proxy_password,
            );
        }
        client_builder = client_builder.proxy(proxy);
    } else if !request.network.use_system_proxy {
        client_builder = client_builder.no_proxy();
    }

    if request.network.client_certificate_type == "pkcs12" {
        client_builder = client_builder.use_native_tls();
    }
    if let Some(identity) = load_client_identity(&request.network)? {
        client_builder = client_builder.identity(identity);
    }

    let client = client_builder.build()?;
    let started = Instant::now();
    let response = send_with_optional_digest(
        &client,
        &method,
        &request.url,
        &headers,
        &request.body,
        request.digest_auth.as_ref(),
    )
    .await?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    if let Some(public_key) = option_env!("APIFORGE_UPDATER_PUBKEY") {
        builder = builder.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(public_key)
                .build(),
        );
    }
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let local_data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&local_data_dir)?;
            let stronghold_salt = local_data_dir.join("stronghold-salt.bin");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&stronghold_salt).build())?;

            let database = Database::open(app)?;
            app.manage(database);
            app.manage(HttpState::open(app)?);
            app.manage(WebSocketState::new());
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
            clear_history,
            start_sse,
            run_script,
            start_websocket,
            send_websocket_message,
            inspect_grpc_descriptor,
            invoke_grpc
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
            assert!(
                is_textual_content_type(content_type),
                "expected textual: {content_type}"
            );
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
            assert!(
                !is_textual_content_type(content_type),
                "expected binary: {content_type}"
            );
        }
    }
}
