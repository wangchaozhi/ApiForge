import { translate as t } from '../i18n/index.ts';
import { CookieManagerPanel } from '../features/cookies/CookieManagerPanel.tsx';
import { EnvironmentPanel } from '../features/environments/EnvironmentPanel.tsx';
import { HistoryPanel } from '../features/history/HistoryPanel.tsx';
import { RequestPanel } from '../features/requests/RequestPanel.tsx';
import { RequestTabs } from '../features/requests/RequestTabs.tsx';
import { ResponsePanel } from '../features/response/ResponsePanel.tsx';
import { SettingsPanel } from '../features/settings/SettingsPanel.tsx';
import { Sidebar } from './Sidebar.tsx';
import { useAppLifecycle } from './useAppLifecycle.ts';
import { useAppStore } from '../store/appStore.ts';

export default function App() {
  useAppLifecycle();
  const activeView = useAppStore((state) => state.activeView);
  const activeRequestId = useAppStore((state) => state.activeRequestId);

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
