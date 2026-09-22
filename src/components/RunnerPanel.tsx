import { Play, Square, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import { makeHistoryEntry, saveHistory } from '../lib/history';
import { createId } from '../lib/id';
import { cancelApiRequest, sendApiRequest, toEngineRequest } from '../lib/request';
import { getActiveEnvironmentValues, useAppStore } from '../store/appStore';

type RunnerResult = {
  id: string;
  iteration: number;
  requestId: string;
  requestName: string;
  method: string;
  status: number | null;
  elapsedMs: number | null;
  error: string | null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function RunnerPanel() {
  useLocale();
  const collections = useAppStore((state) => state.collections);
  const requests = useAppStore((state) => state.requests);
  const variables = useAppStore(getActiveEnvironmentValues);
  const networkSettings = useAppStore((state) => state.networkSettings);
  const prependHistory = useAppStore((state) => state.prependHistory);

  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '');
  const [iterations, setIterations] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [stopOnError, setStopOnError] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunnerResult[]>([]);
  const cancelledRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);

  const collection = collections.find((item) => item.id === collectionId) ?? collections[0];
  const requestById = useMemo(() => new Map(requests.map((request) => [request.id, request])), [requests]);
  const queue = useMemo(() => {
    if (!collection) return [];
    const ids = [
      ...collection.requestIds,
      ...collection.folders.flatMap((folder) => folder.requestIds),
    ];
    return ids.flatMap((id) => {
      const request = requestById.get(id);
      return request ? [request] : [];
    });
  }, [collection, requestById]);

  const cancel = async () => {
    cancelledRef.current = true;
    const operationId = operationIdRef.current;
    if (operationId) await cancelApiRequest(operationId).catch(() => undefined);
  };

  const run = async () => {
    if (!collection || !queue.length || running) return;
    cancelledRef.current = false;
    setRunning(true);
    setResults([]);

    try {
      outer:
      for (let iteration = 1; iteration <= Math.max(1, iterations); iteration += 1) {
        for (const request of queue) {
          if (cancelledRef.current) break outer;
          const operationId = createId('runner-op');
          operationIdRef.current = operationId;

          try {
            const engineRequest = toEngineRequest(request, variables, networkSettings);
            const response = await sendApiRequest(engineRequest, operationId);
            const historyEntry = makeHistoryEntry(request, engineRequest, response);
            prependHistory(historyEntry);
            void saveHistory(historyEntry).catch(() => undefined);
            setResults((current) => [...current, {
              id: createId('runner-result'),
              iteration,
              requestId: request.id,
              requestName: request.name,
              method: request.method,
              status: response.status,
              elapsedMs: response.elapsedMs,
              error: null,
            }]);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setResults((current) => [...current, {
              id: createId('runner-result'),
              iteration,
              requestId: request.id,
              requestName: request.name,
              method: request.method,
              status: null,
              elapsedMs: null,
              error: message,
            }]);
            if (cancelledRef.current || stopOnError) break outer;
          } finally {
            operationIdRef.current = null;
          }

          if (delayMs > 0 && !cancelledRef.current) await sleep(delayMs);
        }
      }
    } finally {
      operationIdRef.current = null;
      setRunning(false);
    }
  };

  return (
    <section className="runner-page">
      <header className="page-header">
        <div>
          <strong>{t('Collection Runner')}</strong>
          <span>{t('Run collection requests sequentially with the active environment.')}</span>
        </div>
        <div className="runner-actions">
          {running ? (
            <button className="secondary-button compact" onClick={() => void cancel()}>
              <Square size={13} /> {t('Stop runner')}
            </button>
          ) : (
            <button className="primary-button compact" disabled={!queue.length} onClick={() => void run()}>
              <Play size={13} /> {t('Run collection')}
            </button>
          )}
          <button className="secondary-button compact" disabled={running || !results.length} onClick={() => setResults([])}>
            <Trash2 size={13} /> {t('Clear results')}
          </button>
        </div>
      </header>

      <div className="runner-config">
        <label>
          <span>{t('Collection')}</span>
          <select value={collection?.id ?? ''} disabled={running} onChange={(event) => setCollectionId(event.target.value)}>
            {collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          <span>{t('Iterations')}</span>
          <input type="number" min={1} max={1000} disabled={running} value={iterations} onChange={(event) => setIterations(Math.max(1, Number(event.target.value) || 1))} />
        </label>
        <label>
          <span>{t('Delay (ms)')}</span>
          <input type="number" min={0} max={600000} disabled={running} value={delayMs} onChange={(event) => setDelayMs(Math.max(0, Number(event.target.value) || 0))} />
        </label>
        <label className="runner-toggle">
          <input type="checkbox" checked={stopOnError} disabled={running} onChange={(event) => setStopOnError(event.target.checked)} />
          <span>{t('Stop on request error')}</span>
        </label>
      </div>

      <div className="runner-summary">
        <strong>{collection?.name ?? t('Collection')}</strong>
        <span>{t('{count} requests per iteration', { count: queue.length })}</span>
        <span>{t('Pre-request and test scripts are saved but not executed until the sandbox runtime is enabled.')}</span>
      </div>

      <div className="runner-results">
        <div className="runner-result-row head">
          <span>{t('Iteration')}</span>
          <span>{t('Method')}</span>
          <span>{t('Request')}</span>
          <span>{t('Status')}</span>
          <span>{t('Time')}</span>
        </div>
        {results.length === 0 ? (
          <div className="page-empty">
            <strong>{t('No runner results yet')}</strong>
            <span>{t('Choose a collection and start a run.')}</span>
          </div>
        ) : results.map((result) => (
          <div className={`runner-result-row ${result.error ? 'error' : ''}`} key={result.id}>
            <span>{result.iteration}</span>
            <span className={`method method-${result.method.toLowerCase()}`}>{result.method}</span>
            <span title={result.error ?? result.requestName}>
              <strong>{result.requestName}</strong>
              {result.error && <small>{result.error}</small>}
            </span>
            <span>{result.status ?? '—'}</span>
            <span>{result.elapsedMs === null ? '—' : `${result.elapsedMs} ms`}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
