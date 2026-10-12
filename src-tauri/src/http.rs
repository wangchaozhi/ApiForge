//! Desktop adapter over the shared `apiforge-engine` crate.

use crate::{
    cookies::persist_cookie_store,
    error::AppError,
    models::{EngineRequest, EngineResponse},
};
use apiforge_engine::ExecutionPolicy;
use reqwest_cookie_store::CookieStoreMutex;
use std::{path::PathBuf, sync::Arc};

pub(crate) use apiforge_engine::http::{load_client_identity, send_with_optional_digest};

/// The desktop app acts for the user on their own machine, so it runs with the trusted policy.
pub(crate) async fn execute_request(
    request: EngineRequest,
    cookie_jar: Arc<CookieStoreMutex>,
    cookie_path: PathBuf,
) -> Result<EngineResponse, AppError> {
    let cookies_enabled = request.network.cookies_enabled;
    let response = apiforge_engine::execute_request(
        request,
        Some(Arc::clone(&cookie_jar)),
        &ExecutionPolicy::trusted(),
    )
    .await?;

    if cookies_enabled {
        let store = cookie_jar.lock().map_err(|_| AppError::CookieLock)?;
        persist_cookie_store(&store, &cookie_path)?;
    }
    Ok(response)
}
