import { Cookie, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { clearCookieJar, listCookies, removeCookie } from '../lib/request';
import type { CookieInfo } from '../types/api';

export function CookieManagerPanel() {
  const [cookies, setCookies] = useState<CookieInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setCookies(await listCookies());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (cookie: CookieInfo) => {
    try {
      await removeCookie(cookie.domain, cookie.path, cookie.name);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const clear = async () => {
    try {
      await clearCookieJar();
      setCookies([]);
      setMessage('Cookie jar cleared.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="cookies-page">
      <div className="page-header">
        <div>
          <strong>Cookie Manager</strong>
          <span>Cookies captured by the desktop request engine and persisted between app sessions.</span>
        </div>
        <div className="page-actions">
          <button className="secondary-button compact" onClick={() => void refresh()}><RefreshCw size={13} /> Refresh</button>
          <button className="secondary-button compact" disabled={!cookies.length} onClick={() => void clear()}><Trash2 size={13} /> Clear all</button>
        </div>
      </div>

      {message && <div className="page-message">{message}</div>}
      {loading ? (
        <div className="page-empty"><Cookie size={22} /><strong>Loading cookies…</strong></div>
      ) : cookies.length === 0 ? (
        <div className="page-empty"><Cookie size={22} /><strong>No cookies stored</strong><span>Send a request to an endpoint that returns Set-Cookie.</span></div>
      ) : (
        <div className="cookie-table-wrap">
          <div className="cookie-row cookie-head">
            <span>Name</span><span>Value</span><span>Domain</span><span>Path</span><span>Flags</span><span>Expires</span><span />
          </div>
          {cookies.map((cookie) => (
            <div className="cookie-row" key={`${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`}>
              <code>{cookie.name}</code>
              <code className="cookie-value" title={cookie.value}>{cookie.value}</code>
              <code>{cookie.domain || '—'}</code>
              <code>{cookie.path || '/'}</code>
              <span className="cookie-flags">{cookie.secure && <b>Secure</b>}{cookie.httpOnly && <b>HttpOnly</b>}{!cookie.secure && !cookie.httpOnly && '—'}</span>
              <span>{cookie.expires ?? 'Session'}</span>
              <button className="icon-button ghost" title="Delete cookie" onClick={() => void remove(cookie)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
