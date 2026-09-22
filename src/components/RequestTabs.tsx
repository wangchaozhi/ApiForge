import { Plus, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function RequestTabs() {
  const requests = useAppStore((state) => state.requests);
  const openRequestIds = useAppStore((state) => state.openRequestIds);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const setActiveRequest = useAppStore((state) => state.setActiveRequest);
  const closeRequest = useAppStore((state) => state.closeRequest);
  const createRequest = useAppStore((state) => state.createRequest);

  const requestById = new Map(requests.map((request) => [request.id, request]));

  return (
    <div className="request-tab-strip" role="tablist" aria-label="Open requests">
      <div className="request-tab-scroll">
        {openRequestIds.map((id) => {
          const request = requestById.get(id);
          if (!request) return null;
          return (
            <div
              key={id}
              className={`request-tab ${id === activeRequestId ? 'active' : ''}`}
              onClick={() => setActiveRequest(id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActiveRequest(id);
                }
              }}
              role="tab"
              tabIndex={id === activeRequestId ? 0 : -1}
              aria-selected={id === activeRequestId}
            >
              <span className={`method method-${request.method.toLowerCase()}`}>{request.method}</span>
              <span className="request-tab-name">{request.name}</span>
              <button
                className="request-tab-close"
                type="button"
                title="Close tab"
                aria-label={`Close ${request.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeRequest(id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="new-tab-button" type="button" title="New request" onClick={() => createRequest()}><Plus size={14} /></button>
    </div>
  );
}
