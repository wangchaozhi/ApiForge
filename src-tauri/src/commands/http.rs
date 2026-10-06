use crate::{
    error::AppError,
    http::execute_request,
    models::{EngineRequest, EngineResponse},
    state::HttpState,
};
use std::sync::Arc;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[tauri::command]
pub(crate) async fn send_request(
    operation_id: String,
    request: EngineRequest,
    http_state: State<'_, HttpState>,
) -> Result<EngineResponse, AppError> {
    let token = CancellationToken::new();
    {
        let mut cancellations = http_state
            .cancellations
            .lock()
            .map_err(|_| AppError::CancellationLock)?;
        cancellations.insert(operation_id.clone(), token.clone());
    }

    let cookie_jar = Arc::clone(&http_state.cookie_jar);
    let cookie_path = http_state.cookie_path.clone();
    let result = tokio::select! {
        _ = token.cancelled() => Err(AppError::Cancelled),
        result = execute_request(request, cookie_jar, cookie_path) => result,
    };

    let mut cancellations = http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?;
    cancellations.remove(&operation_id);
    result
}

#[tauri::command]
pub(crate) fn cancel_request(
    operation_id: String,
    http_state: State<'_, HttpState>,
) -> Result<(), AppError> {
    let cancellations = http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?;
    if let Some(token) = cancellations.get(&operation_id) {
        token.cancel();
    }
    Ok(())
}
