use crate::{error::AppError, models::HistoryEntry};
use rusqlite::{Connection, params};
use std::{fs, sync::Mutex};
use tauri::Manager;

pub(crate) struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub(crate) fn open(app: &tauri::App) -> Result<Self, AppError> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let connection = Connection::open(data_dir.join("apiforge.sqlite3"))?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, AppError> {
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
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub(crate) fn save_history(&self, entry: HistoryEntry) -> Result<(), AppError> {
        let connection = self.connection.lock().map_err(|_| AppError::DatabaseLock)?;
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

    pub(crate) fn list_history(&self, limit: Option<u32>) -> Result<Vec<HistoryEntry>, AppError> {
        let connection = self.connection.lock().map_err(|_| AppError::DatabaseLock)?;
        let limit = limit.unwrap_or(200).clamp(1, 500);
        let limit_i64 = limit as i64;
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

    pub(crate) fn clear_history(&self) -> Result<(), AppError> {
        let connection = self.connection.lock().map_err(|_| AppError::DatabaseLock)?;
        connection.execute("DELETE FROM history", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(index: usize) -> HistoryEntry {
        HistoryEntry {
            id: format!("history-{index}"),
            request_id: "request".into(),
            request_name: "Test request".into(),
            method: "GET".into(),
            url: "https://example.com/".into(),
            status: 200,
            status_text: "OK".into(),
            elapsed_ms: 12,
            size_bytes: 2,
            request_json: "{}".into(),
            response_json: "{}".into(),
            created_at: format!("{index:06}"),
        }
    }

    #[test]
    fn history_roundtrip_replacement_order_and_clear() {
        let database = Database::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        database.save_history(entry(1)).unwrap();
        database.save_history(entry(2)).unwrap();
        let mut replacement = entry(1);
        replacement.status = 201;
        database.save_history(replacement).unwrap();
        let entries = database.list_history(None).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "history-2");
        assert_eq!(entries[1].status, 201);
        assert_eq!(entries[1].request_json, "{}");
        assert_eq!(entries[1].elapsed_ms, 12);
        assert_eq!(database.list_history(Some(1)).unwrap().len(), 1);
        database.clear_history().unwrap();
        assert!(database.list_history(None).unwrap().is_empty());
    }

    #[test]
    fn history_retention_and_query_limits_remain_bounded() {
        let database = Database::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        for index in 0..505 {
            database.save_history(entry(index)).unwrap();
        }
        let entries = database.list_history(Some(1000)).unwrap();
        assert_eq!(entries.len(), 500);
        assert_eq!(entries.last().unwrap().id, "history-5");
        assert_eq!(database.list_history(None).unwrap().len(), 200);
        assert_eq!(database.list_history(Some(0)).unwrap().len(), 1);
    }
}
