use crate::{
    cookies::persist_cookie_store,
    error::AppError,
    models::{EngineBody, EngineRequest, EngineResponse},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::{
    Client, Method, Proxy,
    header::{HeaderMap, HeaderName, HeaderValue},
    multipart,
    redirect::Policy,
};
use reqwest_cookie_store::CookieStoreMutex;
use std::{
    collections::HashMap,
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

pub(crate) async fn execute_request(
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
