import { translate as t, useLocale } from '../../i18n/index.ts';
import { Copy, MoveRight, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore.ts';
import { chooseMoveTarget } from './chooseMoveTarget.ts';

export function RequestTreeItem({ requestId, nested = false }: { requestId: string; nested?: boolean }) {
  useLocale();
  const request = useAppStore((state) => state.requests.find((item) => item.id === requestId));
  const collections = useAppStore((state) => state.collections);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const activeView = useAppStore((state) => state.activeView);
  const setActiveRequest = useAppStore((state) => state.setActiveRequest);
  const duplicateRequest = useAppStore((state) => state.duplicateRequest);
  const moveRequest = useAppStore((state) => state.moveRequest);
  const deleteRequest = useAppStore((state) => state.deleteRequest);
  if (!request) return null;
  return (
    <div className={`tree-request-wrap ${nested ? 'nested' : ''}`} key={request.id}>
      <button
        className={`request-item ${activeView === 'collections' && request.id === activeRequestId ? 'active' : ''}`}
        onClick={() => setActiveRequest(request.id)}
      >
        <span className={`method method-${request.method.toLowerCase()}`}>{request.method}</span>
        <span className="request-name">{request.name}</span>
      </button>
      <div className="tree-request-actions">
        <button className="tree-icon-action" title={t("Duplicate request")} onClick={() => duplicateRequest(request.id)}><Copy size={11} /></button>
        <button className="tree-icon-action" title={t("Move request")} onClick={() => {
          const target = chooseMoveTarget(collections, request.name);
          if (target !== null) moveRequest(request.id, target);
        }}><MoveRight size={11} /></button>
        <button
          className="tree-icon-action danger"
          title={t("Delete request")}
          onClick={() => {
            if (window.confirm(t('Delete “{name}”?', { name: request.name }))) deleteRequest(request.id);
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}
