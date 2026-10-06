mod commands;
mod cookies;
mod database;
mod error;
mod http;
mod models;
mod state;

use database::Database;
use state::HttpState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database = Database::open(app)?;
            app.manage(database);
            app.manage(HttpState::open(app)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::http::send_request,
            commands::http::cancel_request,
            commands::cookies::clear_cookie_jar,
            commands::cookies::list_cookies,
            commands::cookies::remove_cookie,
            commands::history::save_history,
            commands::history::list_history,
            commands::history::clear_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running ApiForge");
}
