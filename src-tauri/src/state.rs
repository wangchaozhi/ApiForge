use crate::error::AppError;
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::BufReader,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

pub(crate) struct HttpState {
    pub(crate) cookie_jar: Arc<CookieStoreMutex>,
    pub(crate) cookie_path: PathBuf,
    pub(crate) cancellations: Mutex<HashMap<String, CancellationToken>>,
}

impl HttpState {
    pub(crate) fn open(app: &tauri::App) -> Result<Self, AppError> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let cookie_path = data_dir.join("cookies.json");
        let cookie_store = if cookie_path.exists() {
            File::open(&cookie_path)
                .ok()
                .and_then(|file| cookie_store::serde::json::load(BufReader::new(file)).ok())
                .unwrap_or_else(CookieStore::new)
        } else {
            CookieStore::new()
        };
        Ok(Self {
            cookie_jar: Arc::new(CookieStoreMutex::new(cookie_store)),
            cookie_path,
            cancellations: Mutex::new(HashMap::new()),
        })
    }
}
