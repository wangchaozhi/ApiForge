use std::fs;
mod digest;
mod grpc;
mod script;
mod sse;
mod websocket;

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
            let local_data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&local_data_dir)?;
            let stronghold_salt = local_data_dir.join("stronghold-salt.bin");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&stronghold_salt).build())?;

            let database = Database::open(app)?;
            app.manage(database);
            app.manage(HttpState::open(app)?);
            app.manage(websocket::WebSocketState::new());
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
            commands::history::clear_history,
            sse::start_sse,
            script::run_script,
            websocket::start_websocket,
            websocket::send_websocket_message,
            grpc::inspect_grpc_descriptor,
            grpc::invoke_grpc
        ])
        .run(tauri::generate_context!())
        .expect("error while running ApiForge");
}
