import { translate as t, useLocale } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { Clock3, RotateCcw, Trash2 } from 'lucide-react';
import { clearHistory, loadHistory } from '../lib/history';
import { useAppStore } from '../store/appStore';
import type { ApiRequest, ApiResponse, HistoryEntry } from '../types/api';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

export function HistoryPanel() {
  const locale = useLocale();
  const history = useAppStore((state) => state.history);
  const setHistory = useAppStore((state) => state.setHistory);
  const importRequest = useAppStore((state) => state.importRequest);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadHistory().then((items) => {
      if (!active) return;
      setHistory(items);
      setLoading(false);
      if (!selectedId && items[0]) setSelectedId(items[0].id);
    }).catch(() => setLoading(false));
    return () => { active = false; };
  }, [setHistory]);

  const selected = useMemo(() => history.find((item) => item.id === selectedId) ?? history[0] ?? null, [history, selectedId]);

  const restore = (entry: HistoryEntry) => {
    try {
      importRequest(JSON.parse(entry.requestJson) as ApiRequest, JSON.parse(entry.responseJson) as ApiResponse);
    } catch {
      // Ignore corrupt historical snapshots; metadata remains readable.
    }
  };

  const clear = async () => {
    await clearHistory();
    setHistory([]);
    setSelectedId(null);
  };

  return (
    <section className="history-page">
      <header className="page-header">
        <div><strong>{t("History")}</strong><span>{t("Stored in SQLite when running the desktop app.")}</span></div>
        <button className="secondary-button" onClick={() => void clear()} disabled={!history.length}><Trash2 size={14} /> {t("Clear")}</button>
      </header>

      {loading ? (
        <div className="page-empty">{t("Loading request history…")}</div>
      ) : !history.length ? (
        <div className="page-empty"><Clock3 size={26} /><strong>{t("No requests yet")}</strong><span>{t("Successful HTTP responses will appear here.")}</span></div>
      ) : (
        <div className="history-layout">
          <div className="history-list">
            {history.map((entry) => (
              <button key={entry.id} className={`history-row ${selected?.id === entry.id ? 'active' : ''}`} onClick={() => setSelectedId(entry.id)}>
                <span className={`method method-${entry.method.toLowerCase()}`}>{entry.method}</span>
                <div><strong>{entry.requestName}</strong><span>{entry.url}</span></div>
                <span className={entry.status < 400 ? 'status-ok' : 'status-bad'}>{entry.status}</span>
                <time>{formatDate(entry.createdAt, locale)}</time>
              </button>
            ))}
          </div>
          {selected && (
            <aside className="history-detail">
              <div className="history-detail-heading">
                <div><strong>{selected.requestName}</strong><span>{selected.method} · {selected.status} {selected.statusText}</span></div>
                <button className="primary-button compact" onClick={() => restore(selected)}><RotateCcw size={14} /> {t("Open as request")}</button>
              </div>
              <dl>
                <div><dt>URL</dt><dd>{selected.url}</dd></div>
                <div><dt>{t("Time")}</dt><dd>{selected.elapsedMs} ms</dd></div>
                <div><dt>{t("Size")}</dt><dd>{formatBytes(selected.sizeBytes)}</dd></div>
                <div><dt>{t("Sent")}</dt><dd>{formatDate(selected.createdAt, locale)}</dd></div>
              </dl>
              <pre>{(() => {
                try { return JSON.stringify(JSON.parse(selected.responseJson), null, 2); } catch { return selected.responseJson; }
              })()}</pre>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
