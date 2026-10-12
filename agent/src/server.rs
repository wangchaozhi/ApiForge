use crate::config::{Config, Mode};
use apiforge_engine::{
    EngineError, ExecutionPolicy,
    models::{EngineRequest, EngineResponse},
    reqwest_cookie_store::{CookieStore, CookieStoreMutex},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq as _;
use tokio_util::sync::CancellationToken;
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    services::{ServeDir, ServeFile},
};

const MAX_REQUEST_BODY_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    token: String,
    mode: Mode,
    policy: ExecutionPolicy,
    cookie_jar: Option<Arc<CookieStoreMutex>>,
    operations: Mutex<HashMap<String, CancellationToken>>,
}

impl AppState {
    pub fn new(config: &Config) -> Self {
        // A relay serves many people, so it never shares one cookie jar between them.
        let cookie_jar = (config.mode == Mode::Local)
            .then(|| Arc::new(CookieStoreMutex::new(CookieStore::new())));
        Self {
            inner: Arc::new(Inner {
                token: config.token.clone(),
                mode: config.mode,
                policy: config.policy.clone(),
                cookie_jar,
                operations: Mutex::new(HashMap::new()),
            }),
        }
    }
}

pub fn router(config: &Config) -> Router {
    let state = AppState::new(config);
    let protected = Router::new()
        .route("/v1/info", get(info))
        .route("/v1/http/send", post(send))
        .route("/v1/http/cancel", post(cancel))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES));

    let api = Router::new()
        .route("/v1/health", get(health))
        .merge(protected)
        .with_state(state)
        .layer(cors(&config.allow_origins));

    match &config.static_dir {
        Some(dir) => api
            .fallback_service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html")))),
        None => api,
    }
}

fn cors(allow_origins: &[String]) -> CorsLayer {
    let origins = if allow_origins.is_empty() {
        // Requests are authorized by a bearer token, never by ambient cookies, so allowing
        // any origin does not expose the agent to cross-site request forgery.
        AllowOrigin::from(Any)
    } else {
        AllowOrigin::list(
            allow_origins
                .iter()
                .filter_map(|origin| HeaderValue::from_str(origin).ok()),
        )
    };
    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        // Chrome's Private Network Access: lets an https:// web app reach a 127.0.0.1 agent.
        .allow_private_network(true)
        .max_age(std::time::Duration::from_secs(600))
}

async fn require_token(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let presented = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .unwrap_or_default();
    let expected = state.inner.token.as_bytes();
    if presented.len() == expected.len() && bool::from(presented.as_bytes().ct_eq(expected)) {
        return next.run(request).await;
    }
    let mut response = ApiError::new(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        "missing or invalid agent token",
    )
    .into_response();
    response.headers_mut().insert(
        HeaderName::from_static("www-authenticate"),
        HeaderValue::from_static("Bearer"),
    );
    response
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    name: &'static str,
    version: &'static str,
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        name: "apiforge-agent",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    name: &'static str,
    version: &'static str,
    mode: &'static str,
    capabilities: Capabilities,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    local_files: bool,
    proxies: bool,
    private_networks: bool,
    cookie_jar: bool,
    max_response_bytes: Option<usize>,
}

async fn info(State(state): State<AppState>) -> Json<Info> {
    let policy = &state.inner.policy;
    Json(Info {
        name: "apiforge-agent",
        version: env!("CARGO_PKG_VERSION"),
        mode: match state.inner.mode {
            Mode::Local => "local",
            Mode::Relay => "relay",
        },
        capabilities: Capabilities {
            local_files: policy.allow_filesystem,
            proxies: policy.allow_proxy,
            private_networks: !policy.block_private_networks,
            cookie_jar: state.inner.cookie_jar.is_some(),
            max_response_bytes: policy.max_response_bytes,
        },
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    operation_id: String,
    request: EngineRequest,
}

/// Removes the cancellation entry when the request finishes or the client disconnects
/// (axum drops the handler future, which also aborts the outgoing request).
struct OperationGuard<'a> {
    state: &'a AppState,
    operation_id: String,
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.state.inner.operations.lock() {
            operations.remove(&self.operation_id);
        }
    }
}

async fn send(
    State(state): State<AppState>,
    Json(body): Json<SendBody>,
) -> Result<Json<EngineResponse>, ApiError> {
    let token = CancellationToken::new();
    {
        let mut operations = state
            .inner
            .operations
            .lock()
            .map_err(|_| ApiError::internal("operation registry is poisoned"))?;
        if let Some(previous) = operations.insert(body.operation_id.clone(), token.clone()) {
            previous.cancel();
        }
    }
    let _guard = OperationGuard {
        state: &state,
        operation_id: body.operation_id,
    };

    let result = tokio::select! {
        _ = token.cancelled() => return Err(ApiError::new(StatusCode::CONFLICT, "cancelled", "request cancelled")),
        result = apiforge_engine::execute_request(
            body.request,
            state.inner.cookie_jar.clone(),
            &state.inner.policy,
        ) => result,
    };
    result.map(Json).map_err(ApiError::from)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelBody {
    operation_id: String,
}

async fn cancel(State(state): State<AppState>, Json(body): Json<CancelBody>) -> StatusCode {
    if let Ok(operations) = state.inner.operations.lock()
        && let Some(token) = operations.get(&body.operation_id)
    {
        token.cancel();
    }
    StatusCode::NO_CONTENT
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    kind: &'static str,
    message: String,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
    kind: &'a str,
}

impl ApiError {
    fn new(status: StatusCode, kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            kind,
            message: message.into(),
        }
    }

    fn internal(message: &str) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", message)
    }
}

impl From<EngineError> for ApiError {
    fn from(error: EngineError) -> Self {
        let (status, kind) = match &error {
            EngineError::Policy(_) => (StatusCode::FORBIDDEN, "policy"),
            EngineError::InvalidMethod(_)
            | EngineError::InvalidUrl(_)
            | EngineError::InvalidHeaderName(_)
            | EngineError::InvalidHeaderValue(_) => (StatusCode::BAD_REQUEST, "invalid_request"),
            EngineError::ResponseTooLarge(_) => (StatusCode::BAD_GATEWAY, "response_too_large"),
            EngineError::Authentication(_) => (StatusCode::BAD_GATEWAY, "authentication"),
            EngineError::Io(_) => (StatusCode::BAD_GATEWAY, "filesystem"),
            EngineError::Http(error) if error.is_timeout() => {
                (StatusCode::GATEWAY_TIMEOUT, "timeout")
            }
            EngineError::Http(_) => (StatusCode::BAD_GATEWAY, "upstream"),
        };
        Self::new(status, kind, error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: &self.message,
                kind: self.kind,
            }),
        )
            .into_response()
    }
}
