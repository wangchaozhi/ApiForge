use crate::{
    cookies::persist_cookie_store,
    digest,
    error::AppError,
    models::{DigestCredentials, EngineBody, EngineRequest, EngineResponse, NetworkSettings},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::{
    Client, Identity, Method, Proxy, RequestBuilder, Response,
    header::{HeaderMap, HeaderName, HeaderValue, WWW_AUTHENTICATE},
    multipart,
    redirect::Policy,
};
use reqwest_cookie_store::CookieStoreMutex;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

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

pub(crate) fn load_client_identity(
    network: &NetworkSettings,
) -> Result<Option<Identity>, AppError> {
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

pub(crate) async fn send_with_optional_digest(
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

pub(crate) async fn execute_request(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_encoding_classifies_text_and_binary_content() {
        for content_type in [
            "",
            "text/plain",
            "APPLICATION/JSON",
            "application/problem+json",
            "image/svg+xml",
        ] {
            assert!(is_textual_content_type(content_type));
        }
        for content_type in ["image/png", "application/pdf", "application/octet-stream"] {
            assert!(!is_textual_content_type(content_type));
        }
    }
}

#[cfg(test)]
mod upstream_tests {
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
