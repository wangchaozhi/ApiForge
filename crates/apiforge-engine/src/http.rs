use crate::{
    digest,
    error::EngineError,
    models::{DigestCredentials, EngineBody, EngineRequest, EngineResponse, NetworkSettings},
    policy::{ExecutionPolicy, PublicOnlyResolver},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::{
    Client, ClientBuilder, Identity, Method, Proxy, RequestBuilder, Response,
    header::{CONTENT_LENGTH, HeaderMap, HeaderName, HeaderValue, WWW_AUTHENTICATE},
    multipart,
    redirect::Policy,
};
use reqwest_cookie_store::CookieStoreMutex;
use std::{
    collections::HashMap,
    fs,
    sync::Arc,
    time::{Duration, Instant},
};

pub const USER_AGENT: &str = concat!("ApiForge/", env!("CARGO_PKG_VERSION"));
const MAX_REDIRECTS: usize = 10;

pub fn is_textual_content_type(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.trim().is_empty()
        || value.starts_with("text/")
        || value.contains("json")
        || value.contains("xml")
        || value.contains("javascript")
        || value.contains("x-www-form-urlencoded")
        || value.contains("svg")
}

pub fn parse_method(method: &str) -> Result<Method, EngineError> {
    Method::from_bytes(method.as_bytes()).map_err(|_| EngineError::InvalidMethod(method.into()))
}

pub fn build_headers(headers: &HashMap<String, String>) -> Result<HeaderMap, EngineError> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| EngineError::InvalidHeaderName(name.clone()))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|_| EngineError::InvalidHeaderValue(name.clone()))?;
        map.insert(header_name, header_value);
    }
    Ok(map)
}

async fn apply_body(
    builder: RequestBuilder,
    body: &EngineBody,
) -> Result<RequestBuilder, EngineError> {
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

pub fn load_client_identity(network: &NetworkSettings) -> Result<Option<Identity>, EngineError> {
    let certificate_path = network.client_certificate_path.trim();
    match network.client_certificate_type.as_str() {
        "none" | "" => Ok(None),
        "pkcs12" => {
            let bytes = fs::read(certificate_path)?;
            Identity::from_pkcs12_der(&bytes, &network.client_certificate_password)
                .map(Some)
                .map_err(EngineError::Http)
        }
        "pem" => {
            let mut pem = fs::read(certificate_path)?;
            let key_path = network.client_key_path.trim();
            if !key_path.is_empty() {
                pem.extend_from_slice(b"\n");
                pem.extend_from_slice(&fs::read(key_path)?);
            }
            Identity::from_pem(&pem)
                .map(Some)
                .map_err(EngineError::Http)
        }
        other => Err(EngineError::Authentication(format!(
            "unsupported client certificate type: {other}"
        ))),
    }
}

/// Apply redirects, TLS, cookies, proxy, client identity and destination guards.
/// Timeouts are left to the caller because streaming protocols use connect timeouts.
pub fn configure_client(
    mut builder: ClientBuilder,
    network: &NetworkSettings,
    policy: &ExecutionPolicy,
    cookie_jar: Option<Arc<CookieStoreMutex>>,
) -> Result<ClientBuilder, EngineError> {
    builder = builder
        .redirect(redirect_policy(network.follow_redirects, policy))
        .tls_danger_accept_invalid_certs(!network.verify_tls)
        .user_agent(USER_AGENT);

    if network.cookies_enabled
        && let Some(cookie_jar) = cookie_jar
    {
        builder = builder.cookie_provider(cookie_jar);
    }

    let proxy_url = network.proxy_url.trim();
    if policy.allow_proxy && !proxy_url.is_empty() {
        let mut proxy = Proxy::all(proxy_url)?;
        if !network.proxy_username.is_empty() {
            proxy = proxy.basic_auth(&network.proxy_username, &network.proxy_password);
        }
        builder = builder.proxy(proxy);
    } else if !policy.allow_proxy || !network.use_system_proxy {
        builder = builder.no_proxy();
    }

    if policy.allow_filesystem {
        if network.client_certificate_type == "pkcs12" {
            builder = builder.use_native_tls();
        }
        if let Some(identity) = load_client_identity(network)? {
            builder = builder.identity(identity);
        }
    }

    if policy.block_private_networks {
        builder = builder.dns_resolver(Arc::new(PublicOnlyResolver));
    }
    Ok(builder)
}

fn redirect_policy(follow: bool, policy: &ExecutionPolicy) -> Policy {
    if !follow {
        return Policy::none();
    }
    if !policy.block_private_networks {
        return Policy::limited(MAX_REDIRECTS);
    }
    let policy = policy.clone();
    Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        match policy.check_url(attempt.url()) {
            Ok(()) => attempt.follow(),
            Err(error) => attempt.error(error.to_string()),
        }
    })
}

pub async fn send_with_optional_digest(
    client: &Client,
    method: &Method,
    url: &str,
    headers: &HeaderMap,
    body: &EngineBody,
    credentials: Option<&DigestCredentials>,
) -> Result<Response, EngineError> {
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
    .map_err(EngineError::Authentication)?;
    drop(response);
    let second = client
        .request(method.clone(), url)
        .headers(headers.clone())
        .header(reqwest::header::AUTHORIZATION, authorization);
    Ok(apply_body(second, body).await?.send().await?)
}

async fn read_body(mut response: Response, limit: Option<usize>) -> Result<Vec<u8>, EngineError> {
    if let Some(limit) = limit {
        let declared = response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok());
        if declared.is_some_and(|length| length > limit as u64) {
            return Err(EngineError::ResponseTooLarge(limit));
        }
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if limit.is_some_and(|limit| bytes.len() + chunk.len() > limit) {
            return Err(EngineError::ResponseTooLarge(limit.unwrap_or_default()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Execute one HTTP request. The cookie jar is used only when the request enables cookies;
/// persisting it afterwards is the caller's job.
pub async fn execute_request(
    request: EngineRequest,
    cookie_jar: Option<Arc<CookieStoreMutex>>,
    policy: &ExecutionPolicy,
) -> Result<EngineResponse, EngineError> {
    policy.check_request(&request)?;
    let method = parse_method(&request.method)?;
    let headers = build_headers(&request.headers)?;

    let builder =
        Client::builder().timeout(Duration::from_millis(request.network.timeout_ms.max(1)));
    let client = configure_client(builder, &request.network, policy, cookie_jar)?.build()?;

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
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    let bytes = read_body(response, policy.max_response_bytes).await?;
    let size_bytes = bytes.len();
    let (body, body_encoding) = if is_textual_content_type(&content_type) {
        (
            String::from_utf8_lossy(&bytes).into_owned(),
            "utf8".to_string(),
        )
    } else {
        (BASE64_STANDARD.encode(&bytes), "base64".to_string())
    };

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EngineField, NetworkSettings};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[test]
    fn classifies_textual_response_types() {
        for content_type in [
            "",
            "text/plain; charset=utf-8",
            "APPLICATION/JSON",
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
        for content_type in [
            "application/pdf",
            "application/octet-stream",
            "image/png",
            "audio/mpeg",
            "video/mp4",
        ] {
            assert!(
                !is_textual_content_type(content_type),
                "expected binary: {content_type}"
            );
        }
    }

    fn network() -> NetworkSettings {
        NetworkSettings {
            timeout_ms: 5_000,
            follow_redirects: true,
            verify_tls: true,
            cookies_enabled: false,
            use_system_proxy: false,
            proxy_url: String::new(),
            proxy_username: String::new(),
            proxy_password: String::new(),
            client_certificate_type: "none".into(),
            client_certificate_path: String::new(),
            client_key_path: String::new(),
            client_certificate_password: String::new(),
        }
    }

    fn request(url: String, body: EngineBody) -> EngineRequest {
        EngineRequest {
            method: "POST".into(),
            url,
            headers: HashMap::from([("X-Test".into(), "yes".into())]),
            body,
            network: network(),
            digest_auth: None,
        }
    }

    /// Serve one canned HTTP response and return what the client sent.
    async fn one_shot_server(response: &'static [u8]) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/echo?tag=one&tag=two",
            listener.local_addr().unwrap()
        );
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let read = socket.read(&mut buffer).await.unwrap();
                received.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&received);
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if received.len() >= end + 4 + length {
                        break;
                    }
                }
                if read == 0 {
                    break;
                }
            }
            socket.write_all(response).await.unwrap();
            socket.shutdown().await.unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        (url, handle)
    }

    #[tokio::test]
    async fn trusted_policy_executes_requests_and_encodes_binary_bodies() {
        let (url, server) = one_shot_server(
            b"HTTP/1.1 201 Created\r\nContent-Type: image/png\r\nContent-Length: 4\r\nConnection: close\r\n\r\n\x00\xff\x80\x01",
        )
        .await;
        let body = EngineBody::Urlencoded {
            fields: vec![
                EngineField {
                    key: "tag".into(),
                    value: "one".into(),
                },
                EngineField {
                    key: "tag".into(),
                    value: "two".into(),
                },
            ],
        };
        let response = execute_request(request(url, body), None, &ExecutionPolicy::trusted())
            .await
            .unwrap();
        assert_eq!(response.status, 201);
        assert_eq!(response.status_text, "Created");
        assert_eq!(response.body_encoding, "base64");
        assert_eq!(response.body, "AP+AAQ==");
        assert_eq!(response.size_bytes, 4);
        let sent = server.await.unwrap().to_ascii_lowercase();
        assert!(sent.starts_with("post /echo?tag=one&tag=two http/1.1"));
        assert!(sent.contains("x-test: yes"));
        assert!(sent.ends_with("tag=one&tag=two"));
    }

    #[tokio::test]
    async fn response_limit_aborts_large_bodies() {
        let (url, _server) = one_shot_server(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 11\r\nConnection: close\r\n\r\nhello world",
        )
        .await;
        let policy = ExecutionPolicy {
            max_response_bytes: Some(5),
            ..ExecutionPolicy::trusted()
        };
        let error = execute_request(request(url, EngineBody::None), None, &policy)
            .await
            .unwrap_err();
        assert!(matches!(error, EngineError::ResponseTooLarge(5)), "{error}");
    }

    #[tokio::test]
    async fn relay_policy_blocks_loopback_files_and_proxies() {
        let policy = ExecutionPolicy::relay(1024);
        let error = execute_request(
            request("http://127.0.0.1:9/".into(), EngineBody::None),
            None,
            &policy,
        )
        .await
        .unwrap_err();
        assert!(matches!(error, EngineError::Policy(_)), "{error}");

        let mut with_file = request(
            "https://example.com/".into(),
            EngineBody::Multipart {
                fields: vec![crate::models::EngineMultipartField {
                    key: "file".into(),
                    value: "/etc/passwd".into(),
                    kind: "file".into(),
                    file_name: None,
                }],
            },
        );
        assert!(matches!(
            policy.check_request(&with_file),
            Err(EngineError::Policy(_))
        ));
        with_file.body = EngineBody::None;
        with_file.network.proxy_url = "http://10.0.0.1:3128".into();
        assert!(matches!(
            policy.check_request(&with_file),
            Err(EngineError::Policy(_))
        ));
        with_file.network.proxy_url.clear();
        with_file.network.client_certificate_type = "pem".into();
        assert!(matches!(
            policy.check_request(&with_file),
            Err(EngineError::Policy(_))
        ));
    }

    #[tokio::test]
    async fn public_only_resolver_rejects_names_that_resolve_to_loopback() {
        let error = execute_request(
            request(
                "http://localtest.invalid.localhost/".into(),
                EngineBody::None,
            ),
            None,
            &ExecutionPolicy::relay(1024),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, EngineError::Policy(_)), "{error}");

        let resolved = PublicOnlyResolver
            .resolve("localhost".parse().unwrap())
            .await;
        assert!(resolved.is_err());
    }

    use reqwest::dns::Resolve as _;
}
