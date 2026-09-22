import { translate as t, useLocale, useLanguageStore } from './i18n';
import { useEffect } from 'react';
import { CookieManagerPanel } from './components/CookieManagerPanel';
import { EnvironmentPanel } from './components/EnvironmentPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { RequestPanel } from './components/RequestPanel';
import { RequestTabs } from './components/RequestTabs';
import { ResponsePanel } from './components/ResponsePanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { loadHistory } from './lib/history';
import { useAppStore } from './store/appStore';

export default function App() {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const refresh = useLanguageStore.getState().refreshSystemLanguage;
    window.addEventListener('languagechange', refresh);
    return () => window.removeEventListener('languagechange', refresh);
  }, []);
  const activeView = useAppStore((state) => state.activeView);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const history = useAppStore((state) => state.history);
  const setHistory = useAppStore((state) => state.setHistory);

  useEffect(() => {
    if (history.length) return;
    void loadHistory(200).then(setHistory).catch(() => undefined);
  }, [history.length, setHistory]);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="workspace">
        <header className="topbar">
          <div className="environment-chip">
            <span className="environment-dot" />
            {t("ApiForge Desktop")}
          </div>
          <div className="topbar-hint">{t('Variables support {syntax} syntax', { syntax: '{{name}}' })}</div>
        </header>
        {activeView === 'collections' && (
          <div className="request-workspace">
            <RequestTabs />
            {activeRequestId ? (
              <div className="main-grid">
                <RequestPanel />
                <ResponsePanel />
              </div>
            ) : (
              <div className="page-empty"><strong>{t("No open request")}</strong><span>{t("Open a request from a collection or create a new one.")}</span></div>
            )}
          </div>
        )}
        {activeView === 'history' && <HistoryPanel />}
        {activeView === 'environments' && <EnvironmentPanel />}
        {activeView === 'cookies' && <CookieManagerPanel />}
        {activeView === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}
