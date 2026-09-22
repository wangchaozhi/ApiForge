use std::{fs, sync::Mutex};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use super::AppError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    id: String,
    request_id: String,
    request_name: String,
    method: String,
    url: String,
    status: u16,
    status_text: String,
    elapsed_ms: u128,
    size_bytes: usize,
    request_json: String,
    response_json: String,
    created_at: String,
}

pub(crate) struct Database {
    connection: Mutex<Connection>,
}

fn initialize_connection(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL,
            request_name TEXT NOT NULL,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            status INTEGER NOT NULL,
            status_text TEXT NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            request_json TEXT NOT NULL,
            response_json TEXT NOT NULL,
            created_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);",
    )?;
    Ok(())
}

impl Database {
    pub(crate) fn open(app: &tauri::App) -> Result<Self, AppError> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let connection = Connection::open(data_dir.join("apiforge.sqlite3"))?;
        initialize_connection(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self, AppError> {
        let connection = Connection::open_in_memory()?;
        initialize_connection(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
}

fn save_history_inner(connection: &Connection, entry: &HistoryEntry) -> Result<(), AppError> {
    connection.execute(
        "INSERT OR REPLACE INTO history (
            id, request_id, request_name, method, url, status, status_text,
            elapsed_ms, size_bytes, request_json, response_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            entry.id,
            entry.request_id,
            entry.request_name,
            entry.method,
            entry.url,
            entry.status,
            entry.status_text,
            entry.elapsed_ms as i64,
            entry.size_bytes as i64,
            entry.request_json,
            entry.response_json,
            entry.created_at,
        ],
    )?;
    connection.execute(
        "DELETE FROM history WHERE id NOT IN (
            SELECT id FROM history ORDER BY created_at DESC LIMIT 500
         )",
        [],
    )?;
    Ok(())
}

fn list_history_inner(connection: &Connection, limit: u32) -> Result<Vec<HistoryEntry>, AppError> {
    let limit_i64 = limit.clamp(1, 500) as i64;
    let mut statement = connection.prepare(
        "SELECT id, request_id, request_name, method, url, status, status_text,
                elapsed_ms, size_bytes, request_json, response_json, created_at
         FROM history
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;

    let rows = statement.query_map([limit_i64], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            request_id: row.get(1)?,
            request_name: row.get(2)?,
            method: row.get(3)?,
            url: row.get(4)?,
            status: row.get(5)?,
            status_text: row.get(6)?,
            elapsed_ms: row.get::<_, i64>(7)? as u128,
            size_bytes: row.get::<_, i64>(8)? as usize,
            request_json: row.get(9)?,
            response_json: row.get(10)?,
            created_at: row.get(11)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

#[tauri::command]
pub(crate) fn save_history(
    entry: HistoryEntry,
    database: State<'_, Database>,
) -> Result<(), AppError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| AppError::DatabaseLock)?;
    save_history_inner(&connection, &entry)
}

#[tauri::command]
pub(crate) fn list_history(
    limit: Option<u32>,
    database: State<'_, Database>,
) -> Result<Vec<HistoryEntry>, AppError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| AppError::DatabaseLock)?;
    list_history_inner(&connection, limit.unwrap_or(200))
}

#[tauri::command]
pub(crate) fn clear_history(database: State<'_, Database>) -> Result<(), AppError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| AppError::DatabaseLock)?;
    connection.execute("DELETE FROM history", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{list_history_inner, save_history_inner, Database, HistoryEntry};

    fn entry(index: usize) -> HistoryEntry {
        HistoryEntry {
            id: format!("history-{index:03}"),
            request_id: "request".into(),
            request_name: format!("Request {index}"),
            method: "GET".into(),
            url: format!("https://example.com/{index}"),
            status: 200,
            status_text: "OK".into(),
            elapsed_ms: index as u128,
            size_bytes: index,
            request_json: "{}".into(),
            response_json: "{}".into(),
            created_at: format!("2026-09-22T16:{:02}:{:02}.{:03}Z", (index / 60) % 60, index % 60, index),
        }
    }

    #[test]
    fn keeps_only_latest_500_entries() {
        let database = Database::in_memory().expect("in-memory database");
        let connection = database.connection.lock().expect("database lock");

        for index in 0..505 {
            save_history_inner(&connection, &entry(index)).expect("save history");
        }

        let rows = list_history_inner(&connection, 500).expect("list history");
        assert_eq!(rows.len(), 500);
        assert_eq!(rows.first().map(|row| row.id.as_str()), Some("history-504"));
        assert!(!rows.iter().any(|row| row.id == "history-000"));
    }

    #[test]
    fn clamps_history_query_limit() {
        let database = Database::in_memory().expect("in-memory database");
        let connection = database.connection.lock().expect("database lock");
        for index in 0..3 {
            save_history_inner(&connection, &entry(index)).expect("save history");
        }

        assert_eq!(list_history_inner(&connection, 0).expect("minimum limit").len(), 1);
        assert_eq!(list_history_inner(&connection, 999).expect("maximum limit").len(), 3);
    }
}
