use std::{collections::HashMap, sync::Mutex, time::Duration};

use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD as BASE64_STANDARD, STANDARD_NO_PAD as BASE64_NO_PAD},
};
use futures_util::{SinkExt, StreamExt};
use reqwest::Url;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::{
    net::TcpStream,
    sync::mpsc::{self, UnboundedReceiver, UnboundedSender},
};
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, client_async_tls_with_config,
    tungstenite::{
        Message,
        client::IntoClientRequest,
        http::{HeaderName, HeaderValue},
        protocol::{CloseFrame, frame::coding::CloseCode},
    },
};
use tokio_util::sync::CancellationToken;

use crate::{error::AppError, models::EngineRequest, state::HttpState, transport};

const WEBSOCKET_EVENT_NAME: &str = "apiforge://websocket";
/// RFC 6455 limits control-frame payloads (ping/pong/close) to 125 bytes.
const MAX_CONTROL_PAYLOAD: usize = 125;
/// How long to wait for the server to acknowledge a client-initiated close.
const CLOSE_ACK_TIMEOUT: Duration = Duration::from_secs(2);

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub(crate) struct WebSocketState {
    senders: Mutex<HashMap<String, UnboundedSender<Message>>>,
}

impl WebSocketState {
    pub(crate) fn new() -> Self {
        Self {
            senders: Mutex::new(HashMap::new()),
        }
    }

    fn senders(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, UnboundedSender<Message>>>, AppError>
    {
        self.senders
            .lock()
            .map_err(|_| AppError::Protocol("WebSocket sender lock is poisoned".into()))
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
        status: u16,
        headers: HashMap<String, String>,
        protocol: Option<String>,
    },
    /// An incoming data frame. Binary payloads are Base64 encoded.
    Message {
        operation_id: String,
        data: String,
        binary: bool,
    },
    /// An outgoing frame, emitted after it was written to the socket.
    Sent {
        operation_id: String,
        data: String,
        kind: &'static str,
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

struct Target {
    host: String,
    port: u16,
    secure: bool,
}

fn target(url: &str) -> Result<Target, AppError> {
    let url =
        Url::parse(url).map_err(|error| AppError::Protocol(format!("invalid URL: {error}")))?;
    let secure = match url.scheme() {
        "ws" => false,
        "wss" => true,
        other => {
            return Err(AppError::Protocol(format!(
                "WebSocket URLs must use ws:// or wss://, not {other}://"
            )));
        }
    };
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Protocol("WebSocket URL has no host".into()))?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = url.port().unwrap_or(if secure { 443 } else { 80 });
    Ok(Target { host, port, secure })
}

/// Converts a payload from the UI into a frame. Binary payloads arrive Base64 encoded so the
/// UI can display and edit them as text, matching how incoming binary frames are reported.
fn outgoing_message(kind: &str, data: String) -> Result<Message, AppError> {
    match kind {
        "text" => Ok(Message::Text(data.into())),
        "binary" => {
            let compact = data.split_whitespace().collect::<String>();
            BASE64_STANDARD
                .decode(&compact)
                .or_else(|_| BASE64_NO_PAD.decode(&compact))
                .map(|bytes| Message::Binary(bytes.into()))
                .map_err(|_| AppError::Protocol("binary payload must be valid Base64".into()))
        }
        "ping" => {
            if data.len() > MAX_CONTROL_PAYLOAD {
                return Err(AppError::Protocol(format!(
                    "ping payload must be at most {MAX_CONTROL_PAYLOAD} bytes"
                )));
            }
            Ok(Message::Ping(data.into_bytes().into()))
        }
        other => Err(AppError::Protocol(format!(
            "unsupported WebSocket message kind: {other}"
        ))),
    }
}

fn describe_outgoing(message: &Message) -> Option<(&'static str, String)> {
    match message {
        Message::Text(text) => Some(("text", text.to_string())),
        Message::Binary(bytes) => Some(("binary", BASE64_STANDARD.encode(bytes))),
        Message::Ping(bytes) => Some(("ping", String::from_utf8_lossy(bytes).into_owned())),
        _ => None,
    }
}

async fn open_socket(request: &EngineRequest) -> Result<(Socket, WebSocketEvent), AppError> {
    let target = target(&request.url)?;
    let mut handshake = request
        .url
        .as_str()
        .into_client_request()
        .map_err(|error| AppError::Protocol(error.to_string()))?;
    for (name, value) in &request.headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| AppError::InvalidHeaderName(name.clone()))?;
        let header_value =
            HeaderValue::from_str(value).map_err(|_| AppError::InvalidHeaderValue(name.clone()))?;
        handshake.headers_mut().insert(header_name, header_value);
    }

    let stream = transport::connect_tcp(&target.host, target.port, &request.network).await?;
    let connector = if target.secure {
        Connector::NativeTls(transport::tls_connector(&request.network, &[])?)
    } else {
        Connector::Plain
    };
    let timeout = Duration::from_millis(request.network.timeout_ms.max(1));
    let (socket, response) = tokio::time::timeout(
        timeout,
        client_async_tls_with_config(handshake, stream, None, Some(connector)),
    )
    .await
    .map_err(|_| AppError::Protocol("WebSocket handshake timed out".into()))?
    .map_err(|error| AppError::Protocol(error.to_string()))?;

    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| {
            (
                key.as_str().to_string(),
                value.to_str().unwrap_or("<binary header>").to_string(),
            )
        })
        .collect::<HashMap<_, _>>();
    let protocol = response
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let opened = WebSocketEvent::Opened {
        operation_id: String::new(),
        status: response.status().as_u16(),
        headers,
        protocol,
    };
    Ok((socket, opened))
}

/// Sends a normal close frame and waits briefly for the server's close acknowledgement.
async fn close_gracefully(socket: &mut Socket) -> (Option<u16>, String) {
    let frame = CloseFrame {
        code: CloseCode::Normal,
        reason: "".into(),
    };
    if socket.close(Some(frame)).await.is_err() {
        return (Some(1000), String::new());
    }
    let acknowledgement = tokio::time::timeout(CLOSE_ACK_TIMEOUT, async {
        while let Some(Ok(message)) = socket.next().await {
            if let Message::Close(frame) = message {
                return frame;
            }
        }
        None
    })
    .await
    .ok()
    .flatten();
    acknowledgement
        .map(|frame| (Some(frame.code.into()), frame.reason.to_string()))
        .unwrap_or((Some(1000), String::new()))
}

async fn run_session(
    operation_id: &str,
    request: EngineRequest,
    token: CancellationToken,
    mut receiver: UnboundedReceiver<Message>,
    app: &AppHandle,
) -> Result<(), AppError> {
    let (mut socket, mut opened) = tokio::select! {
        _ = token.cancelled() => return Err(AppError::Cancelled),
        result = open_socket(&request) => result?,
    };
    if let WebSocketEvent::Opened {
        operation_id: id, ..
    } = &mut opened
    {
        *id = operation_id.to_string();
    }
    app.emit(WEBSOCKET_EVENT_NAME, opened)?;

    let id = || operation_id.to_string();
    loop {
        tokio::select! {
            _ = token.cancelled() => {
                let (code, reason) = close_gracefully(&mut socket).await;
                app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Closed { operation_id: id(), code, reason })?;
                return Ok(());
            }
            outbound = receiver.recv() => {
                let Some(outbound) = outbound else { return Ok(()) };
                let description = describe_outgoing(&outbound);
                socket.send(outbound).await.map_err(|error| AppError::Protocol(error.to_string()))?;
                if let Some((kind, data)) = description {
                    app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Sent { operation_id: id(), data, kind })?;
                }
            }
            incoming = socket.next() => {
                let event = match incoming {
                    Some(Ok(Message::Text(text))) => WebSocketEvent::Message { operation_id: id(), data: text.to_string(), binary: false },
                    Some(Ok(Message::Binary(bytes))) => WebSocketEvent::Message { operation_id: id(), data: BASE64_STANDARD.encode(bytes), binary: true },
                    Some(Ok(Message::Ping(bytes))) => WebSocketEvent::Ping { operation_id: id(), data: String::from_utf8_lossy(&bytes).into_owned() },
                    Some(Ok(Message::Pong(bytes))) => WebSocketEvent::Pong { operation_id: id(), data: String::from_utf8_lossy(&bytes).into_owned() },
                    Some(Ok(Message::Close(frame))) => {
                        // Flush tungstenite's queued close reply before reporting the close.
                        let _ = socket.close(None).await;
                        let (code, reason) = frame
                            .map(|value| (Some(value.code.into()), value.reason.to_string()))
                            .unwrap_or((None, String::new()));
                        app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Closed { operation_id: id(), code, reason })?;
                        return Ok(());
                    }
                    Some(Ok(Message::Frame(_))) => continue,
                    Some(Err(error)) => return Err(AppError::Protocol(error.to_string())),
                    None => {
                        app.emit(WEBSOCKET_EVENT_NAME, WebSocketEvent::Closed {
                            operation_id: id(),
                            code: Some(1006),
                            reason: "connection closed without a close frame".into(),
                        })?;
                        return Ok(());
                    }
                };
                app.emit(WEBSOCKET_EVENT_NAME, event)?;
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn start_websocket(
    operation_id: String,
    request: EngineRequest,
    app: AppHandle,
    http_state: State<'_, HttpState>,
    websocket_state: State<'_, WebSocketState>,
) -> Result<(), AppError> {
    // Register before connecting so Disconnect also aborts a pending connection attempt.
    let token = CancellationToken::new();
    http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?
        .insert(operation_id.clone(), token.clone());
    let (sender, receiver) = mpsc::unbounded_channel();
    websocket_state
        .senders()?
        .insert(operation_id.clone(), sender);

    let result = run_session(&operation_id, request, token, receiver, &app).await;

    websocket_state.senders()?.remove(&operation_id);
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
    kind: String,
    websocket_state: State<'_, WebSocketState>,
) -> Result<(), AppError> {
    let message = outgoing_message(&kind, data)?;
    let senders = websocket_state.senders()?;
    let sender = senders
        .get(&operation_id)
        .ok_or_else(|| AppError::Protocol("WebSocket is not connected".into()))?;
    sender
        .send(message)
        .map_err(|_| AppError::Protocol("WebSocket connection is closed".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::tests::{network, spawn_connect_proxy};
    use tokio::net::TcpListener;

    #[test]
    fn websocket_runtime_starts_empty() {
        assert!(WebSocketState::new().senders().unwrap().is_empty());
    }

    #[test]
    fn resolves_targets() {
        let plain = target("ws://127.0.0.1:9000/socket").unwrap();
        assert_eq!((plain.host.as_str(), plain.port, plain.secure), ("127.0.0.1", 9000, false));
        let secure = target("wss://example.com/socket").unwrap();
        assert_eq!((secure.host.as_str(), secure.port, secure.secure), ("example.com", 443, true));
        assert_eq!(target("ws://[::1]/").unwrap().host, "::1");
        assert!(target("https://example.com").is_err());
    }

    #[test]
    fn converts_outgoing_payloads() {
        assert!(matches!(outgoing_message("text", "hi".into()), Ok(Message::Text(text)) if text.as_str() == "hi"));
        assert!(matches!(outgoing_message("binary", "AAEC".into()), Ok(Message::Binary(bytes)) if bytes.as_ref() == [0, 1, 2]));
        assert!(matches!(outgoing_message("binary", "AA EC\nAw".into()), Ok(Message::Binary(bytes)) if bytes.as_ref() == [0, 1, 2, 3]));
        assert!(outgoing_message("binary", "not base64!".into()).is_err());
        assert!(matches!(outgoing_message("ping", "hb".into()), Ok(Message::Ping(_))));
        assert!(outgoing_message("ping", "x".repeat(126)).is_err());
        assert!(outgoing_message("pong", String::new()).is_err());
    }

    fn engine_request(url: &str, proxy: &str) -> EngineRequest {
        EngineRequest {
            method: "GET".into(),
            url: url.into(),
            headers: HashMap::from([("x-test".to_string(), "1".to_string())]),
            body: crate::models::EngineBody::None,
            network: network(proxy),
            digest_auth: None,
        }
    }

    #[tokio::test]
    async fn echoes_through_connect_proxy() {
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = server.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (stream, _) = server.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(message)) = socket.next().await {
                if message.is_text() || message.is_binary() {
                    socket.send(message).await.unwrap();
                }
            }
        });
        let proxy = spawn_connect_proxy(None).await;

        let request = engine_request(&format!("ws://127.0.0.1:{port}/echo"), &format!("http://{proxy}"));
        let (mut socket, opened) = open_socket(&request).await.unwrap();
        assert!(matches!(opened, WebSocketEvent::Opened { status: 101, .. }));

        socket.send(outgoing_message("binary", "AAEC".into()).unwrap()).await.unwrap();
        let reply = socket.next().await.unwrap().unwrap();
        assert_eq!(reply.into_data().as_ref(), [0, 1, 2]);

        let (code, _) = close_gracefully(&mut socket).await;
        assert_eq!(code, Some(1000));
    }

    #[tokio::test]
    async fn connect_fails_fast_on_refused_port() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let request = engine_request(&format!("ws://127.0.0.1:{port}/"), "");
        assert!(open_socket(&request).await.is_err());
    }
}
