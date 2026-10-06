import { translate as t, useLocale } from '../i18n/index.ts';
import { Play, Network, Waypoints, PlugZap, Radio, Braces, Clock3, Cookie, Folder, Plus, Settings2 } from 'lucide-react';
import { useAppStore } from '../store/appStore.ts';
import { CollectionTree } from '../features/collections/CollectionTree.tsx';

export function Sidebar() {
  useLocale();
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const createRequest = useAppStore((state) => state.createRequest);
  const historyCount = useAppStore((state) => state.history.length);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <strong>ApiForge</strong>
          <span>{t("Local workspace")}</span>
        </div>
      </div>

      <button className="new-request" onClick={() => createRequest()}>
        <Plus size={16} /> {t("New Request")}
      </button>

      <nav className="nav-list" aria-label={t("Workspace navigation")}>
        <button className={`nav-item ${activeView === 'collections' ? 'active-static' : ''}`} onClick={() => setActiveView('collections')}><Folder size={15} /> {t("Collections")}</button>
        <button className={`nav-item ${activeView === 'runner' ? 'active-static' : ''}`} onClick={() => setActiveView('runner')}><Play size={15} /> {t('Runner')}</button>
        <button className={`nav-item ${activeView === 'graphql' ? 'active-static' : ''}`} onClick={() => setActiveView('graphql')}><Network size={15} /> {t('GraphQL')}</button>
        <button className={`nav-item ${activeView === 'grpc' ? 'active-static' : ''}`} onClick={() => setActiveView('grpc')}><Waypoints size={15} /> {t('gRPC')}</button>
        <button className={`nav-item ${activeView === 'websocket' ? 'active-static' : ''}`} onClick={() => setActiveView('websocket')}><PlugZap size={15} /> {t('WebSocket')}</button>
        <button className={`nav-item ${activeView === 'sse' ? 'active-static' : ''}`} onClick={() => setActiveView('sse')}><Radio size={15} /> {t('SSE')}</button>
        <button className={`nav-item ${activeView === 'history' ? 'active-static' : ''}`} onClick={() => setActiveView('history')}><Clock3 size={15} /> {t("History")} {historyCount > 0 && <span className="nav-count">{historyCount}</span>}</button>
        <button className={`nav-item ${activeView === 'environments' ? 'active-static' : ''}`} onClick={() => setActiveView('environments')}><Braces size={15} /> {t("Environments")}</button>
        <button className={`nav-item ${activeView === 'cookies' ? 'active-static' : ''}`} onClick={() => setActiveView('cookies')}><Cookie size={15} /> {t("Cookies")}</button>
      </nav>

      <CollectionTree />

      <div className="sidebar-footer">
        <button className={`nav-item ${activeView === 'settings' ? 'active-static' : ''}`} onClick={() => setActiveView('settings')}><Settings2 size={15} /> {t("Settings")}</button>
      </div>
    </aside>
  );
}
