use crate::{cookies, error::AppError, models::CookieInfo, state::HttpState};
use tauri::State;

#[tauri::command]
pub(crate) fn clear_cookie_jar(http_state: State<'_, HttpState>) -> Result<(), AppError> {
    cookies::clear_cookie_jar(&http_state)
}

#[tauri::command]
pub(crate) fn list_cookies(http_state: State<'_, HttpState>) -> Result<Vec<CookieInfo>, AppError> {
    cookies::list_cookies(&http_state)
}

#[tauri::command]
pub(crate) fn remove_cookie(
    domain: String,
    path: String,
    name: String,
    http_state: State<'_, HttpState>,
) -> Result<(), AppError> {
    cookies::remove_cookie(domain, path, name, &http_state)
}
