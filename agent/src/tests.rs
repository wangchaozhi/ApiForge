use crate::{
    config::{Config, Mode, TokenSource},
    server::router,
};
use apiforge_engine::ExecutionPolicy;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tower::ServiceExt as _;

const TOKEN: &str = "test-token-0123456789";

fn config(mode: Mode) -> Config {
    Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        mode,
        token: TOKEN.into(),
        token_source: TokenSource::Explicit,
        allow_origins: Vec::new(),
        static_dir: None,
        policy: match mode {
            Mode::Local => ExecutionPolicy::trusted(),
            Mode::Relay => ExecutionPolicy::relay(1024),
        },
    }
}

fn authorized(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
    match body {
        Some(body) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

async fn call(app: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn engine_request(url: &str) -> Value {
    json!({
        "method": "GET",
        "url": url,
        "headers": { "X-From-Agent": "1" },
        "body": { "type": "none" },
        "network": {
            "timeoutMs": 5000, "followRedirects": true, "verifyTls": true, "cookiesEnabled": true,
            "useSystemProxy": false, "proxyUrl": "", "proxyUsername": "", "proxyPassword": "",
            "clientCertificateType": "none", "clientCertificatePath": "", "clientKeyPath": "",
            "clientCertificatePassword": ""
        }
    })
}

/// Accept one connection; reply with `response` unless it is empty (then hang).
async fn upstream(response: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/data", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0_u8; 4096];
        let _ = socket.read(&mut buffer).await.unwrap();
        if response.is_empty() {
            tokio::time::sleep(Duration::from_secs(30)).await;
        } else {
            socket.write_all(response.as_bytes()).await.unwrap();
            let _ = socket.shutdown().await;
        }
    });
    url
}

#[tokio::test]
async fn health_is_public_but_everything_else_needs_the_token() {
    let app = router(&config(Mode::Local));
    let (status, body) = call(
        &app,
        Request::get("/v1/health").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "apiforge-agent");

    let (status, body) = call(&app, Request::get("/v1/info").body(Body::empty()).unwrap()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["kind"], "unauthorized");

    let wrong = Request::get("/v1/info")
        .header(header::AUTHORIZATION, "Bearer test-token-0123456780")
        .body(Body::empty())
        .unwrap();
    assert_eq!(call(&app, wrong).await.0, StatusCode::UNAUTHORIZED);

    let (status, body) = call(&app, authorized("GET", "/v1/info", None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["mode"], "local");
    assert_eq!(body["capabilities"]["privateNetworks"], true);
    assert_eq!(body["capabilities"]["cookieJar"], true);
}

#[tokio::test]
async fn preflight_allows_private_network_access() {
    let app = router(&config(Mode::Local));
    let response = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/v1/http/send")
                .header(header::ORIGIN, "https://forge.example.com")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(
                    header::ACCESS_CONTROL_REQUEST_HEADERS,
                    "authorization,content-type",
                )
                .header("access-control-request-private-network", "true")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(response.status().is_success());
    let headers = response.headers();
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
    assert_eq!(headers["access-control-allow-private-network"], "true");
}

#[tokio::test]
async fn local_mode_relays_requests_to_localhost() {
    let url = upstream(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: session=abc\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}",
    )
    .await;
    let app = router(&config(Mode::Local));
    let (status, body) = call(
        &app,
        authorized(
            "POST",
            "/v1/http/send",
            Some(json!({ "operationId": "op-1", "request": engine_request(&url) })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], 200);
    assert_eq!(body["bodyEncoding"], "utf8");
    assert_eq!(body["body"], "{\"ok\":true}");
    assert_eq!(body["headers"]["set-cookie"], "session=abc");
}

#[tokio::test]
async fn relay_mode_refuses_internal_destinations() {
    let app = router(&config(Mode::Relay));
    let (status, body) = call(
        &app,
        authorized(
            "POST",
            "/v1/http/send",
            Some(
                json!({ "operationId": "op-2", "request": engine_request("http://127.0.0.1:9/") }),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["kind"], "policy");

    let (_, info) = call(&app, authorized("GET", "/v1/info", None)).await;
    assert_eq!(info["mode"], "relay");
    assert_eq!(info["capabilities"]["localFiles"], false);
    assert_eq!(info["capabilities"]["cookieJar"], false);
    assert_eq!(info["capabilities"]["maxResponseBytes"], 1024);
}

#[tokio::test]
async fn cancel_stops_an_in_flight_request() {
    let url = upstream("").await;
    let app = router(&config(Mode::Local));
    let pending = {
        let app = app.clone();
        tokio::spawn(async move {
            call(
                &app,
                authorized(
                    "POST",
                    "/v1/http/send",
                    Some(json!({ "operationId": "slow", "request": engine_request(&url) })),
                ),
            )
            .await
        })
    };
    tokio::time::sleep(Duration::from_millis(200)).await;
    let (status, _) = call(
        &app,
        authorized(
            "POST",
            "/v1/http/cancel",
            Some(json!({ "operationId": "slow" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body) = tokio::time::timeout(Duration::from_secs(5), pending)
        .await
        .expect("cancelled request should finish promptly")
        .unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["kind"], "cancelled");
}

#[tokio::test]
async fn serves_the_web_app_with_spa_fallback() {
    let dir = std::env::temp_dir().join(format!("apiforge-agent-static-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(
        dir.join("index.html"),
        "<!doctype html><title>ApiForge</title>",
    )
    .unwrap();
    std::fs::write(dir.join("assets/app.js"), "console.log(1)").unwrap();
    let mut config = config(Mode::Relay);
    config.static_dir = Some(PathBuf::from(&dir));
    let app = router(&config);

    for (uri, expected) in [
        ("/", "<!doctype html>"),
        ("/collections/123", "<!doctype html>"),
        ("/assets/app.js", "console.log"),
    ] {
        let response = app
            .clone()
            .oneshot(Request::get(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert!(
            String::from_utf8_lossy(&bytes).starts_with(expected),
            "{uri}"
        );
    }
    let _ = std::fs::remove_dir_all(dir);
}
