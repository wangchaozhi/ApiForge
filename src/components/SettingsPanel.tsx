import { translate as t, useLocale, useLanguageStore } from '../i18n';
import { Cookie, RotateCcw, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { clearCookieJar, isTauriRuntime } from '../lib/request';
import { useAppStore } from '../store/appStore';
import { WorkspaceTransferPanel } from './WorkspaceTransferPanel';

export function SettingsPanel() {
  useLocale();
  const language = useLanguageStore((state) => state.preference);
  const setLanguage = useLanguageStore((state) => state.setPreference);
  const settings = useAppStore((state) => state.networkSettings);
  const update = useAppStore((state) => state.updateNetworkSettings);
  const reset = useAppStore((state) => state.resetNetworkSettings);
  const [cookieMessage, setCookieMessage] = useState<string | null>(null);

  const clearCookies = async () => {
    try {
      await clearCookieJar();
      setCookieMessage(t("Cookie jar cleared."));
    } catch (error) {
      setCookieMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseCertificateFile = async (target: 'certificate' | 'key') => {
    if (!isTauriRuntime()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const filters = target === 'certificate'
      ? [{ name: 'Certificates', extensions: settings.clientCertificateType === 'pkcs12' ? ['p12', 'pfx'] : ['pem', 'crt', 'cer'] }]
      : [{ name: 'Private keys', extensions: ['pem', 'key'] }];
    const selected = await open({ multiple: false, directory: false, filters });
    if (typeof selected !== 'string') return;
    if (target === 'certificate') update({ clientCertificatePath: selected });
    else update({ clientKeyPath: selected });
  };

  return (
    <section className="settings-page">
      <div className="page-header">
        <div>
          <strong>{t("Settings")}</strong>
          <span>{t("Applied to every request. Custom proxy overrides system proxy discovery.")}</span>
        </div>
        <button className="secondary-button compact" onClick={reset}><RotateCcw size={13} /> {t("Reset defaults")}</button>
      </div>

      <div className="settings-content">
        <div className="settings-card">
          <label className="settings-field">
            <span>{t('Language')}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as 'system' | 'en' | 'zh-CN')}>
              <option value="system">{t('System default')}</option>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <p className="settings-description">{t('Choose the display language. Your workspace data stays unchanged.')}</p>
        </div>
        <WorkspaceTransferPanel />

        <div className="settings-card">
          <div className="settings-card-title"><SlidersHorizontal size={16} /><div><strong>{t("Request behavior")}</strong><span>{t("Timeout and redirect policy")}</span></div></div>
          <label className="settings-field">
            <span>{t("Timeout (milliseconds)")}</span>
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
            <div><strong>{t("Follow redirects")}</strong><span>{t("Follow up to 10 redirects automatically.")}</span></div>
          </label>
        </div>

        <div className="settings-card">
          <div className="settings-card-title"><ShieldCheck size={16} /><div><strong>{t("TLS & proxy")}</strong><span>{t("Desktop request engine configuration")}</span></div></div>
          <label className="settings-toggle warning-toggle">
            <input type="checkbox" checked={settings.verifyTls} onChange={(event) => update({ verifyTls: event.target.checked })} />
            <div><strong>{t("Verify TLS certificates")}</strong><span>{t("Disable only when testing trusted local/self-signed endpoints.")}</span></div>
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={settings.useSystemProxy} onChange={(event) => update({ useSystemProxy: event.target.checked })} />
            <div><strong>{t("Use system proxy")}</strong><span>{t("Honor the operating system / environment proxy configuration.")}</span></div>
          </label>
          <label className="settings-field">
            <span>{t("Custom proxy URL")}</span>
            <input
              value={settings.proxyUrl}
              onChange={(event) => update({ proxyUrl: event.target.value })}
              placeholder="http://127.0.0.1:8080"
              spellCheck={false}
            />
          </label>
          <div className="settings-grid-two">
            <label className="settings-field">
              <span>{t('Proxy username')}</span>
              <input
                value={settings.proxyUsername}
                onChange={(event) => update({ proxyUsername: event.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span>{t('Proxy password')}</span>
              <input
                type="password"
                value={settings.proxyPassword}
                onChange={(event) => update({ proxyPassword: event.target.value })}
                autoComplete="off"
              />
            </label>
          </div>
          <p className="settings-description">{t('Proxy passwords are session-only and are not saved to workspace storage.')}</p>

          <label className="settings-field">
            <span>{t('Client certificate')}</span>
            <select
              value={settings.clientCertificateType}
              onChange={(event) => update({
                clientCertificateType: event.target.value as 'none' | 'pkcs12' | 'pem',
                clientCertificatePath: '',
                clientKeyPath: '',
                clientCertificatePassword: '',
              })}
            >
              <option value="none">{t('None')}</option>
              <option value="pkcs12">PKCS#12 / P12 / PFX</option>
              <option value="pem">PEM + PKCS#8 key</option>
            </select>
          </label>

          {settings.clientCertificateType !== 'none' && (
            <>
              <div className="settings-file-row">
                <label className="settings-field">
                  <span>{settings.clientCertificateType === 'pkcs12' ? t('Certificate bundle') : t('Certificate PEM')}</span>
                  <input
                    value={settings.clientCertificatePath}
                    onChange={(event) => update({ clientCertificatePath: event.target.value })}
                    placeholder={settings.clientCertificateType === 'pkcs12' ? '/path/client.p12' : '/path/client.pem'}
                    spellCheck={false}
                  />
                </label>
                <button
                  className="secondary-button compact"
                  disabled={!isTauriRuntime()}
                  onClick={() => void chooseCertificateFile('certificate')}
                >
                  {t('Choose file')}
                </button>
              </div>

              {settings.clientCertificateType === 'pem' && (
                <div className="settings-file-row">
                  <label className="settings-field">
                    <span>{t('PKCS#8 private key')}</span>
                    <input
                      value={settings.clientKeyPath}
                      onChange={(event) => update({ clientKeyPath: event.target.value })}
                      placeholder="/path/key.pem"
                      spellCheck={false}
                    />
                  </label>
                  <button
                    className="secondary-button compact"
                    disabled={!isTauriRuntime()}
                    onClick={() => void chooseCertificateFile('key')}
                  >
                    {t('Choose file')}
                  </button>
                </div>
              )}

              {settings.clientCertificateType === 'pkcs12' && (
                <label className="settings-field">
                  <span>{t('Certificate password')}</span>
                  <input
                    type="password"
                    value={settings.clientCertificatePassword}
                    onChange={(event) => update({ clientCertificatePassword: event.target.value })}
                    autoComplete="off"
                  />
                </label>
              )}
              <p className="settings-description">{t('Certificate passwords are session-only and are not saved to workspace storage.')}</p>
            </>
          )}
        </div>

        <div className="settings-card">
          <div className="settings-card-title"><Cookie size={16} /><div><strong>{t("Cookies")}</strong><span>{t("Shared session cookie jar across requests")}</span></div></div>
          <label className="settings-toggle">
            <input type="checkbox" checked={settings.cookiesEnabled} onChange={(event) => update({ cookiesEnabled: event.target.checked })} />
            <div><strong>{t("Enable cookie jar")}</strong><span>{t("Store Set-Cookie values and resend matching cookies on later requests.")}</span></div>
          </label>
          <div className="settings-inline-action">
            <button className="secondary-button compact" onClick={() => void clearCookies()}><Trash2 size={13} /> {t("Clear cookie jar")}</button>
            {cookieMessage && <span>{cookieMessage}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
