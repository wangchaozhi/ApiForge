use std::{collections::HashMap, sync::Arc, time::Duration};

use reqwest::{
    Client, Method, Proxy,
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
};
use reqwest_cookie_store::CookieStoreMutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

use super::{
    AppError, EngineRequest, HttpState, load_client_identity, persist_cookie_store,
    send_with_optional_digest,
};

const SSE_EVENT_NAME: &str = "apiforge://sse";

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum SseNativeEvent {
    Opened {
        operation_id: String,
        status: u16,
        status_text: String,
        headers: HashMap<String, String>,
    },
    Chunk {
        operation_id: String,
        bytes: Vec<u8>,
    },
    Closed {
        operation_id: String,
    },
}

async fn stream_sse(
    operation_id: &str,
    request: EngineRequest,
    token: CancellationToken,
    app: &AppHandle,
    cookie_jar: Arc<CookieStoreMutex>,
) -> Result<(), AppError> {
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
        // SSE is long-lived: the normal request timeout becomes a connect timeout.
        .connect_timeout(Duration::from_millis(request.network.timeout_ms.max(1)))
        .tls_danger_accept_invalid_certs(!request.network.verify_tls)
        .user_agent(concat!("ApiForge/", env!("CARGO_PKG_VERSION")));

    if request.network.cookies_enabled {
        client_builder = client_builder.cookie_provider(cookie_jar);
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
    let mut response = tokio::select! {
        _ = token.cancelled() => return Err(AppError::Cancelled),
        response = send_with_optional_digest(
            &client,
            &method,
            &request.url,
            &headers,
            &request.body,
            request.digest_auth.as_ref(),
        ) => response?,
    };

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

    app.emit(
        SSE_EVENT_NAME,
        SseNativeEvent::Opened {
            operation_id: operation_id.to_string(),
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_string(),
            headers: response_headers,
        },
    )?;

    loop {
        let next = tokio::select! {
            _ = token.cancelled() => return Err(AppError::Cancelled),
            chunk = response.chunk() => chunk?,
        };

        match next {
            Some(bytes) => {
                app.emit(
                    SSE_EVENT_NAME,
                    SseNativeEvent::Chunk {
                        operation_id: operation_id.to_string(),
                        bytes: bytes.to_vec(),
                    },
                )?;
            }
            None => break,
        }
    }

    app.emit(
        SSE_EVENT_NAME,
        SseNativeEvent::Closed {
            operation_id: operation_id.to_string(),
        },
    )?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn start_sse(
    operation_id: String,
    request: EngineRequest,
    app: AppHandle,
    http_state: State<'_, HttpState>,
) -> Result<(), AppError> {
    let cookies_enabled = request.network.cookies_enabled;
    let token = CancellationToken::new();
    {
        let mut cancellations = http_state
            .cancellations
            .lock()
            .map_err(|_| AppError::CancellationLock)?;
        cancellations.insert(operation_id.clone(), token.clone());
    }

    let result = stream_sse(
        &operation_id,
        request,
        token,
        &app,
        Arc::clone(&http_state.cookie_jar),
    )
    .await;

    if cookies_enabled {
        let store = http_state
            .cookie_jar
            .lock()
            .map_err(|_| AppError::CookieLock)?;
        persist_cookie_store(&store, &http_state.cookie_path)?;
    }

    let mut cancellations = http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?;
    cancellations.remove(&operation_id);

    result
}
