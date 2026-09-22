import { Cookie, RotateCcw, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { clearCookieJar } from '../lib/request';
import { useAppStore } from '../store/appStore';

export function SettingsPanel() {
  const settings = useAppStore((state) => state.networkSettings);
  const update = useAppStore((state) => state.updateNetworkSettings);
  const reset = useAppStore((state) => state.resetNetworkSettings);
  const [cookieMessage, setCookieMessage] = useState<string | null>(null);

  const clearCookies = async () => {
    try {
      await clearCookieJar();
      setCookieMessage('Cookie jar cleared.');
    } catch (error) {
      setCookieMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="settings-page">
      <div className="page-header">
        <div>
          <strong>Network Settings</strong>
          <span>Applied to every request. Custom proxy overrides system proxy discovery.</span>
        </div>
        <button className="secondary-button compact" onClick={reset}><RotateCcw size={13} /> Reset defaults</button>
      </div>

      <div className="settings-content">
        <div className="settings-card">
          <div className="settings-card-title"><SlidersHorizontal size={16} /><div><strong>Request behavior</strong><span>Timeout and redirect policy</span></div></div>
          <label className="settings-field">
            <span>Timeout (milliseconds)</span>
            <input
              type="number"
              min={1}
              max={600000}
              value={settings.timeoutMs}
              onChange={(event) => update({ timeoutMs: Math.max(1, Number(event.target.value) || 1) })}
            />
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={settings.followRedirects} onChange={(event) => update({ followRedirects: event.target.checked })} />
            <div><strong>Follow redirects</strong><span>Follow up to 10 redirects automatically.</span></div>
          </label>
        </div>

        <div className="settings-card">
          <div className="settings-card-title"><ShieldCheck size={16} /><div><strong>TLS & proxy</strong><span>Desktop request engine configuration</span></div></div>
          <label className="settings-toggle warning-toggle">
            <input type="checkbox" checked={settings.verifyTls} onChange={(event) => update({ verifyTls: event.target.checked })} />
            <div><strong>Verify TLS certificates</strong><span>Disable only when testing trusted local/self-signed endpoints.</span></div>
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={settings.useSystemProxy} onChange={(event) => update({ useSystemProxy: event.target.checked })} />
            <div><strong>Use system proxy</strong><span>Honor the operating system / environment proxy configuration.</span></div>
          </label>
          <label className="settings-field">
            <span>Custom proxy URL</span>
            <input
              value={settings.proxyUrl}
              onChange={(event) => update({ proxyUrl: event.target.value })}
              placeholder="http://127.0.0.1:8080"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="settings-card">
          <div className="settings-card-title"><Cookie size={16} /><div><strong>Cookies</strong><span>Shared session cookie jar across requests</span></div></div>
          <label className="settings-toggle">
            <input type="checkbox" checked={settings.cookiesEnabled} onChange={(event) => update({ cookiesEnabled: event.target.checked })} />
            <div><strong>Enable cookie jar</strong><span>Store Set-Cookie values and resend matching cookies on later requests.</span></div>
          </label>
          <div className="settings-inline-action">
            <button className="secondary-button compact" onClick={() => void clearCookies()}><Trash2 size={13} /> Clear cookie jar</button>
            {cookieMessage && <span>{cookieMessage}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
