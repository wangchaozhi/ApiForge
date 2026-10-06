use crate::{database::Database, error::AppError, models::HistoryEntry};
use tauri::State;

#[tauri::command]
pub(crate) fn save_history(
    entry: HistoryEntry,
    database: State<'_, Database>,
) -> Result<(), AppError> {
    database.save_history(entry)
}

#[tauri::command]
pub(crate) fn list_history(
    limit: Option<u32>,
    database: State<'_, Database>,
) -> Result<Vec<HistoryEntry>, AppError> {
    database.list_history(limit)
}

#[tauri::command]
pub(crate) fn clear_history(database: State<'_, Database>) -> Result<(), AppError> {
    database.clear_history()
}
