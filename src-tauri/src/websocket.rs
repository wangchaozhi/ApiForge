use std::{collections::HashMap, fs, sync::Mutex};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_tungstenite::{
    Connector, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest, http::HeaderValue},
};
use tokio_util::sync::CancellationToken;

use super::{AppError, EngineRequest, HttpState};

const WEBSOCKET_EVENT_NAME: &str = "apiforge://websocket";

pub(crate) struct WebSocketState {
    senders: Mutex<HashMap<String, UnboundedSender<Message>>>,
}

impl WebSocketState {
    pub(crate) fn new() -> Self {
        Self {
            senders: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum WebSocketEvent {
    Opened {
        operation_id: String,
    },
    Message {
        operation_id: String,
        data: String,
        binary: bool,
    },
    Ping {
        operation_id: String,
        data: String,
    },
    Pong {
        operation_id: String,
        data: String,
    },
    Closed {
        operation_id: String,
        code: Option<u16>,
        reason: String,
    },
}

fn connector(request: &EngineRequest) -> Result<Option<Connector>, AppError> {
    if !request.url.to_ascii_lowercase().starts_with("wss://") {
        return Ok(None);
    }
    let mut builder = native_tls::TlsConnector::builder();
    builder.danger_accept_invalid_certs(!request.network.verify_tls);
    match request.network.client_certificate_type.as_str() {
        "none" | "" => {}
        "pkcs12" => {
            let bytes = fs::read(request.network.client_certificate_path.trim())?;
            let identity = native_tls::Identity::from_pkcs12(
                &bytes,
                &request.network.client_certificate_password,
            )
            .map_err(|error| AppError::Authentication(error.to_string()))?;
            builder.identity(identity);
        }
        "pem" => {
            let cert = fs::read(request.network.client_certificate_path.trim())?;
            let key = fs::read(request.network.client_key_path.trim())?;
            let identity = native_tls::Identity::from_pkcs8(&cert, &key)
                .map_err(|error| AppError::Authentication(error.to_string()))?;
            builder.identity(identity);
        }
        other => {
            return Err(AppError::Authentication(format!(
                "unsupported client certificate type: {other}"
            )));
        }
    }
    Ok(Some(Connector::NativeTls(builder.build().map_err(
        |error| AppError::Authentication(error.to_string()),
    )?)))
}

#[tauri::command]
pub(crate) async fn start_websocket(
    operation_id: String,
    request: EngineRequest,
    app: AppHandle,
    http_state: State<'_, HttpState>,
    websocket_state: State<'_, WebSocketState>,
) -> Result<(), AppError> {
    if !request.network.proxy_url.trim().is_empty() {
        return Err(AppError::Protocol(
            "custom proxy is not yet supported for WebSocket connections".into(),
        ));
    }

    let mut handshake = request
        .url
        .as_str()
        .into_client_request()
        .map_err(|error| AppError::Protocol(error.to_string()))?;
    for (name, value) in &request.headers {
        let name = tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| AppError::InvalidHeaderName(name.clone()))?;
        let value = HeaderValue::from_str(value)
            .map_err(|_| AppError::InvalidHeaderValue(name.to_string()))?;
        handshake.headers_mut().insert(name, value);
    }

    let token = CancellationToken::new();
    let (mut socket, _) =
        connect_async_tls_with_config(handshake, None, false, connector(&request)?)
            .await
            .map_err(|error| AppError::Protocol(error.to_string()))?;
    http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?
        .insert(operation_id.clone(), token.clone());
    let (sender, mut receiver) = mpsc::unbounded_channel();
    websocket_state
        .senders
        .lock()
        .map_err(|_| AppError::Protocol("WebSocket sender lock is poisoned".into()))?
        .insert(operation_id.clone(), sender);
    app.emit(
        WEBSOCKET_EVENT_NAME,
        WebSocketEvent::Opened {
            operation_id: operation_id.clone(),
        },
    )?;

    let result = loop {
        tokio::select! {
            _ = token.cancelled() => {
                let _ = socket.close(None).await;
                break Ok(());
            }
            outbound = receiver.recv() => {
                let Some(outbound) = outbound else { break Ok(()) };
                socket.send(outbound).await.map_err(|error| AppError::Protocol(error.to_string()))?;
            }
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Message { operation_id: operation_id.clone(), data: text.to_string(), binary: false })?,
                    Some(Ok(Message::Binary(bytes))) => app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Message { operation_id: operation_id.clone(), data: BASE64_STANDARD.encode(bytes), binary: true })?,
                    Some(Ok(Message::Ping(bytes))) => app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Ping { operation_id: operation_id.clone(), data: BASE64_STANDARD.encode(bytes) })?,
                    Some(Ok(Message::Pong(bytes))) => app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Pong { operation_id: operation_id.clone(), data: BASE64_STANDARD.encode(bytes) })?,
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame.map(|value| (Some(value.code.into()), value.reason.to_string())).unwrap_or((None, String::new()));
                        app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Closed { operation_id: operation_id.clone(), code, reason })?;
                        break Ok(());
                    }
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Err(error)) => break Err(AppError::Protocol(error.to_string())),
                    None => break Ok(()),
                }
            }
        }
    };

    websocket_state
        .senders
        .lock()
        .map_err(|_| AppError::Protocol("WebSocket sender lock is poisoned".into()))?
        .remove(&operation_id);
    http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?
        .remove(&operation_id);
    result
}

#[tauri::command]
pub(crate) fn send_websocket_message(
    operation_id: String,
    data: String,
    binary: bool,
    websocket_state: State<'_, WebSocketState>,
) -> Result<(), AppError> {
    let senders = websocket_state
        .senders
        .lock()
        .map_err(|_| AppError::Protocol("WebSocket sender lock is poisoned".into()))?;
    let sender = senders
        .get(&operation_id)
        .ok_or_else(|| AppError::Protocol("WebSocket is not connected".into()))?;
    let message = if binary {
        Message::Binary(data.into_bytes().into())
    } else {
        Message::Text(data.into())
    };
    sender
        .send(message)
        .map_err(|_| AppError::Protocol("WebSocket connection is closed".into()))
}

#[cfg(test)]
mod tests {
    use super::WebSocketState;

    #[test]
    fn websocket_runtime_starts_empty() {
        assert!(WebSocketState::new().senders.lock().unwrap().is_empty());
    }
}
