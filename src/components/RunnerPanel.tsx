import { Play, Square, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import { makeHistoryEntry, saveHistory } from '../lib/history';
import { createId } from '../lib/id';
import { cancelApiRequest, refreshOAuthAccessToken, sendApiRequest, toEngineRequest } from '../lib/request';
import {
  applyEnvironmentMutations,
  applyHeaderMutations,
  runRequestScript,
  type ScriptTestResult,
} from '../lib/scripts';
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
  tests: ScriptTestResult[];
  logs: string[];
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function RunnerPanel() {
  useLocale();
  const collections = useAppStore((state) => state.collections);
  const requests = useAppStore((state) => state.requests);
  const environmentProfiles = useAppStore((state) => state.environmentProfiles);
  const networkSettings = useAppStore((state) => state.networkSettings);
  const prependHistory = useAppStore((state) => state.prependHistory);

  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '');
  const [environmentId, setEnvironmentId] = useState(() => useAppStore.getState().activeEnvironmentId);
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
    const runVariables = { ...getActiveEnvironmentValues({ environmentProfiles, activeEnvironmentId: environmentId }) };

    try {
      outer:
      for (let iteration = 1; iteration <= Math.max(1, iterations); iteration += 1) {
        for (const request of queue) {
          if (cancelledRef.current) break outer;

          let responseStatus: number | null = null;
          let responseElapsed: number | null = null;
          let scriptTests: ScriptTestResult[] = [];
          let scriptLogs: string[] = [];
          let errorMessage: string | null = null;

          try {
            const preScript = await runRequestScript(
              'preRequest',
              request.preRequestScript ?? '',
              runVariables,
              request,
            );
            applyEnvironmentMutations(runVariables, preScript.environment);
            scriptTests = [...scriptTests, ...preScript.tests];
            scriptLogs = [...scriptLogs, ...preScript.logs];

            const requestToSend = request.auth.type === 'oauth2'
              ? { ...request, auth: await refreshOAuthAccessToken(request.auth, runVariables, networkSettings) }
              : request;
            const engineRequest = toEngineRequest(requestToSend, runVariables, networkSettings);
            applyHeaderMutations(engineRequest.headers, preScript.headers);

            const operationId = createId('runner-op');
            operationIdRef.current = operationId;
            const response = await sendApiRequest(engineRequest, operationId);
            operationIdRef.current = null;
            responseStatus = response.status;
            responseElapsed = response.elapsedMs;

            const historyEntry = makeHistoryEntry(request, engineRequest, response);
            prependHistory(historyEntry);
            void saveHistory(historyEntry).catch(() => undefined);

            const testScript = await runRequestScript(
              'test',
              request.testScript ?? '',
              runVariables,
              engineRequest,
              response,
            );
            applyEnvironmentMutations(runVariables, testScript.environment);
            scriptTests = [...scriptTests, ...testScript.tests];
            scriptLogs = [...scriptLogs, ...testScript.logs];
          } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
          } finally {
            operationIdRef.current = null;
          }

          const failedTests = scriptTests.filter((test) => !test.passed);
          setResults((current) => [...current, {
            id: createId('runner-result'),
            iteration,
            requestId: request.id,
            requestName: request.name,
            method: request.method,
            status: responseStatus,
            elapsedMs: responseElapsed,
            error: errorMessage,
            tests: scriptTests,
            logs: scriptLogs,
          }]);

          if (cancelledRef.current || (stopOnError && (errorMessage !== null || failedTests.length > 0))) {
            break outer;
          }

          if (delayMs > 0) await sleep(delayMs);
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
          <span>{t('Environment')}</span>
          <select value={environmentId} disabled={running} onChange={(event) => setEnvironmentId(event.target.value)}>
            {environmentProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
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
          <span>{t('Stop on request or test failure')}</span>
        </label>
      </div>

      <div className="runner-summary">
        <strong>{collection?.name ?? t('Collection')}</strong>
        <span>{t('{count} requests per iteration', { count: queue.length })}</span>
        <span>{t('Scripts run in an isolated Rust JavaScript sandbox; environment changes are scoped to this run.')}</span>
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
        ) : results.map((result) => {
          const failedTests = result.tests.filter((test) => !test.passed);
          const rowFailed = Boolean(result.error) || failedTests.length > 0;
          const detail = result.error
            ?? (failedTests.length
              ? failedTests.map((test) => `${test.name}: ${test.message || t('Failed')}`).join('\n')
              : result.logs.join('\n'));

          return (
            <div className={`runner-result-row ${rowFailed ? 'error' : ''}`} key={result.id}>
              <span>{result.iteration}</span>
              <span className={`method method-${result.method.toLowerCase()}`}>{result.method}</span>
              <span title={detail || result.requestName}>
                <strong>{result.requestName}</strong>
                {result.error && <small>{result.error}</small>}
                {!result.error && result.tests.length > 0 && (
                  <small className={failedTests.length ? '' : 'runner-tests-passed'}>
                    {t('{passed}/{total} tests passed', {
                      passed: result.tests.length - failedTests.length,
                      total: result.tests.length,
                    })}
                  </small>
                )}
                {!result.error && result.tests.length === 0 && result.logs.length > 0 && (
                  <small className="runner-log-summary">{t('{count} script logs', { count: result.logs.length })}</small>
                )}
              </span>
              <span>{result.status ?? '—'}</span>
              <span>{result.elapsedMs === null ? '—' : `${result.elapsedMs} ms`}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
