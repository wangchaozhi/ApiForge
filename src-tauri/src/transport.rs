//! Raw TCP/TLS transport shared by the long-lived protocol engines (WebSocket and gRPC).
//!
//! reqwest owns proxying and TLS for ordinary HTTP and SSE, but tungstenite and tonic need a
//! plain byte stream. This module reproduces the relevant parts of the network settings for
//! them: HTTP CONNECT proxy tunnelling (optionally authenticated), TLS verification, and
//! PKCS#12 / PEM client certificates.

use std::{fs, time::Duration};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::Url;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use crate::{error::AppError, models::NetworkSettings};

const MAX_PROXY_RESPONSE_HEAD: usize = 16 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ProxyTarget {
    host: String,
    port: u16,
    authorization: Option<String>,
}

/// Resolves the explicit proxy configured in the network settings.
///
/// Only `http://` proxies can tunnel arbitrary TCP via CONNECT, so other schemes are rejected
/// with a clear error instead of being silently bypassed. The system proxy is not consulted
/// for raw streams; those connections go direct when no explicit proxy is configured.
pub(crate) fn proxy_target(network: &NetworkSettings) -> Result<Option<ProxyTarget>, AppError> {
    let raw = network.proxy_url.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    let url = Url::parse(&with_scheme)
        .map_err(|error| AppError::Protocol(format!("invalid proxy URL: {error}")))?;
    if url.scheme() != "http" {
        return Err(AppError::Protocol(format!(
            "{} proxies are not supported for WebSocket/gRPC connections; use an HTTP CONNECT proxy",
            url.scheme()
        )));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Protocol("proxy URL has no host".into()))?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = url.port_or_known_default().unwrap_or(80);

    let (username, password) = if !network.proxy_username.is_empty() {
        (
            network.proxy_username.clone(),
            network.proxy_password.clone(),
        )
    } else {
        (
            percent_decode(url.username()),
            percent_decode(url.password().unwrap_or("")),
        )
    };
    let authorization = (!username.is_empty()).then(|| {
        format!(
            "Basic {}",
            BASE64_STANDARD.encode(format!("{username}:{password}"))
        )
    });

    Ok(Some(ProxyTarget {
        host,
        port,
        authorization,
    }))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or_default();
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn authority(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

pub(crate) fn connect_request(host: &str, port: u16, authorization: Option<&str>) -> String {
    let target = authority(host, port);
    let mut request = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some(authorization) = authorization {
        request.push_str("Proxy-Authorization: ");
        request.push_str(authorization);
        request.push_str("\r\n");
    }
    request.push_str("\r\n");
    request
}

/// Validates the status line of a CONNECT response head (everything before the blank line).
pub(crate) fn check_connect_response(head: &[u8]) -> Result<(), AppError> {
    let text = String::from_utf8_lossy(head);
    let status_line = text.lines().next().unwrap_or_default();
    let mut parts = status_line.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let code = parts.next().unwrap_or_default();
    if !version.starts_with("HTTP/1.") {
        return Err(AppError::Protocol(format!(
            "proxy returned an invalid CONNECT response: {status_line}"
        )));
    }
    match code {
        "200" => Ok(()),
        "407" => Err(AppError::Authentication(
            "proxy authentication required (407)".into(),
        )),
        _ => Err(AppError::Protocol(format!(
            "proxy refused CONNECT: {status_line}"
        ))),
    }
}

async fn read_connect_response(stream: &mut TcpStream) -> Result<(), AppError> {
    // Read byte by byte so no tunnelled bytes are consumed past the end of the response head.
    let mut head = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= MAX_PROXY_RESPONSE_HEAD {
            return Err(AppError::Protocol("proxy CONNECT response is too large".into()));
        }
        if stream.read(&mut byte).await? == 0 {
            return Err(AppError::Protocol(
                "proxy closed the connection during CONNECT".into(),
            ));
        }
        head.push(byte[0]);
    }
    check_connect_response(&head)
}

async fn open_tcp(host: &str, port: u16, network: &NetworkSettings) -> Result<TcpStream, AppError> {
    let stream = match proxy_target(network)? {
        Some(proxy) => {
            let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port)).await?;
            stream
                .write_all(connect_request(host, port, proxy.authorization.as_deref()).as_bytes())
                .await?;
            read_connect_response(&mut stream).await?;
            stream
        }
        None => TcpStream::connect((host, port)).await?,
    };
    stream.set_nodelay(true)?;
    Ok(stream)
}

/// Opens a TCP stream to `host:port`, tunnelling through the configured proxy when present.
/// The whole connect (including the proxy handshake) is bounded by the request timeout.
pub(crate) async fn connect_tcp(
    host: &str,
    port: u16,
    network: &NetworkSettings,
) -> Result<TcpStream, AppError> {
    let timeout = Duration::from_millis(network.timeout_ms.max(1));
    tokio::time::timeout(timeout, open_tcp(host, port, network))
        .await
        .map_err(|_| AppError::Protocol(format!("connection to {host}:{port} timed out")))?
}

/// Builds a native-tls connector honouring TLS verification and client-certificate settings.
pub(crate) fn tls_connector(
    network: &NetworkSettings,
    alpn: &[&str],
) -> Result<native_tls::TlsConnector, AppError> {
    let mut builder = native_tls::TlsConnector::builder();
    builder.danger_accept_invalid_certs(!network.verify_tls);
    if !alpn.is_empty() {
        builder.request_alpns(alpn);
    }
    match network.client_certificate_type.as_str() {
        "none" | "" => {}
        "pkcs12" => {
            let bytes = fs::read(network.client_certificate_path.trim())?;
            let identity =
                native_tls::Identity::from_pkcs12(&bytes, &network.client_certificate_password)
                    .map_err(|error| AppError::Authentication(error.to_string()))?;
            builder.identity(identity);
        }
        "pem" => {
            let cert = fs::read(network.client_certificate_path.trim())?;
            let key = fs::read(network.client_key_path.trim())?;
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
    builder
        .build()
        .map_err(|error| AppError::Authentication(error.to_string()))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tokio::net::TcpListener;

    pub(crate) fn network(proxy_url: &str) -> NetworkSettings {
        NetworkSettings {
            timeout_ms: 5_000,
            follow_redirects: true,
            verify_tls: true,
            cookies_enabled: false,
            use_system_proxy: false,
            proxy_url: proxy_url.into(),
            proxy_username: String::new(),
            proxy_password: String::new(),
            client_certificate_type: "none".into(),
            client_certificate_path: String::new(),
            client_key_path: String::new(),
            client_certificate_password: String::new(),
        }
    }

    #[test]
    fn no_proxy_when_url_is_blank() {
        assert_eq!(proxy_target(&network("  ")).unwrap(), None);
    }

    #[test]
    fn parses_proxy_with_url_credentials() {
        let target = proxy_target(&network("http://user%40corp:p%3Ass@proxy.local:3128"))
            .unwrap()
            .unwrap();
        assert_eq!(target.host, "proxy.local");
        assert_eq!(target.port, 3128);
        assert_eq!(
            target.authorization.as_deref(),
            Some(format!("Basic {}", BASE64_STANDARD.encode("user@corp:p:ss")).as_str())
        );
    }

    #[test]
    fn explicit_proxy_credentials_override_url_credentials() {
        let mut settings = network("proxy.local");
        settings.proxy_username = "alice".into();
        settings.proxy_password = "secret".into();
        let target = proxy_target(&settings).unwrap().unwrap();
        assert_eq!(target.port, 80);
        assert_eq!(
            target.authorization.as_deref(),
            Some(format!("Basic {}", BASE64_STANDARD.encode("alice:secret")).as_str())
        );
    }

    #[test]
    fn rejects_non_http_proxies() {
        assert!(proxy_target(&network("socks5://127.0.0.1:1080")).is_err());
        assert!(proxy_target(&network("https://proxy.local")).is_err());
    }

    #[test]
    fn formats_connect_requests() {
        assert_eq!(
            connect_request("example.com", 443, Some("Basic abc")),
            "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic abc\r\n\r\n"
        );
        assert!(connect_request("::1", 8080, None).starts_with("CONNECT [::1]:8080 HTTP/1.1\r\n"));
    }

    #[test]
    fn checks_connect_status() {
        assert!(check_connect_response(b"HTTP/1.1 200 Connection established\r\n\r\n").is_ok());
        assert!(matches!(
            check_connect_response(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"),
            Err(AppError::Authentication(_))
        ));
        assert!(check_connect_response(b"HTTP/1.0 403 Forbidden\r\n\r\n").is_err());
        assert!(check_connect_response(b"SSH-2.0-OpenSSH\r\n\r\n").is_err());
    }

    /// Minimal HTTP CONNECT proxy used by transport and protocol tests.
    /// Returns the proxy address; every accepted tunnel is spliced to its CONNECT target.
    pub(crate) async fn spawn_connect_proxy(required_auth: Option<String>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            while let Ok((mut client, _)) = listener.accept().await {
                let required_auth = required_auth.clone();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut byte = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        if client.read(&mut byte).await.unwrap_or(0) == 0 {
                            return;
                        }
                        head.push(byte[0]);
                    }
                    let head = String::from_utf8_lossy(&head).into_owned();
                    if let Some(expected) = required_auth {
                        let header = format!("Proxy-Authorization: {expected}\r\n");
                        if !head.contains(&header) {
                            let _ = client
                                .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                                .await;
                            return;
                        }
                    }
                    let target = head.split_whitespace().nth(1).unwrap_or_default().to_string();
                    let Ok(mut upstream) = TcpStream::connect(target).await else {
                        let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n").await;
                        return;
                    };
                    client
                        .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                        .await
                        .unwrap();
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
                });
            }
        });
        address
    }

    #[tokio::test]
    async fn tunnels_through_authenticated_proxy() {
        let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = echo.accept().await.unwrap();
            let mut buffer = [0u8; 5];
            socket.read_exact(&mut buffer).await.unwrap();
            socket.write_all(&buffer).await.unwrap();
        });

        let auth = format!("Basic {}", BASE64_STANDARD.encode("alice:secret"));
        let proxy = spawn_connect_proxy(Some(auth)).await;

        let mut settings = network(&format!("http://{proxy}"));
        assert!(matches!(
            connect_tcp("127.0.0.1", echo_port, &settings).await,
            Err(AppError::Authentication(_))
        ));

        settings.proxy_username = "alice".into();
        settings.proxy_password = "secret".into();
        let mut stream = connect_tcp("127.0.0.1", echo_port, &settings).await.unwrap();
        stream.write_all(b"hello").await.unwrap();
        let mut reply = [0u8; 5];
        stream.read_exact(&mut reply).await.unwrap();
        assert_eq!(&reply, b"hello");
    }
}
