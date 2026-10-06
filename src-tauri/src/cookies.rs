use crate::{error::AppError, models::CookieInfo, state::HttpState};
use reqwest_cookie_store::CookieStore;
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

pub(crate) fn persist_cookie_store(store: &CookieStore, path: &Path) -> Result<(), AppError> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    cookie_store::serde::json::save_incl_expired_and_nonpersistent(store, &mut writer)
        .map_err(|error| AppError::CookiePersistence(error.to_string()))?;
    writer.flush()?;
    Ok(())
}

pub(crate) fn clear_cookie_jar(http_state: &HttpState) -> Result<(), AppError> {
    let mut store = http_state
        .cookie_jar
        .lock()
        .map_err(|_| AppError::CookieLock)?;
    store.clear();
    persist_cookie_store(&store, &http_state.cookie_path)
}

pub(crate) fn list_cookies(http_state: &HttpState) -> Result<Vec<CookieInfo>, AppError> {
    let store = http_state
        .cookie_jar
        .lock()
        .map_err(|_| AppError::CookieLock)?;
    let mut cookies = store
        .iter_unexpired()
        .map(|cookie| CookieInfo {
            domain: cookie
                .domain
                .as_cow()
                .map(|value| value.into_owned())
                .unwrap_or_default(),
            path: cookie.path.as_ref().to_owned(),
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            secure: cookie.secure().unwrap_or(false),
            http_only: cookie.http_only().unwrap_or(false),
            expires: cookie.expires_datetime().map(|value| value.to_string()),
        })
        .collect::<Vec<_>>();
    cookies.sort_by(|a, b| (&a.domain, &a.path, &a.name).cmp(&(&b.domain, &b.path, &b.name)));
    Ok(cookies)
}

pub(crate) fn remove_cookie(
    domain: String,
    path: String,
    name: String,
    http_state: &HttpState,
) -> Result<(), AppError> {
    let mut store = http_state
        .cookie_jar
        .lock()
        .map_err(|_| AppError::CookieLock)?;
    store.remove(&domain, &path, &name);
    persist_cookie_store(&store, &http_state.cookie_path)
}
