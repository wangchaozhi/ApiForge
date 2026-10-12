import { Radio, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { translate as t, useLocale } from '../../i18n/index.ts';
import { createId } from '../../lib/id.ts';
import { toEngineRequest } from '../../services/http/buildRequest.ts';
import {
  cancelSse, isSseResponseOk, planSseReconnect, streamSse,
  type SseAttemptOutcome, type SseEvent, type SseOpened, type SseStopReason,
} from '../../services/sse.ts';
import { isTauriRuntime } from '../../platform/runtime.ts';
import { getActiveEnvironmentValues, useAppStore } from '../../store/appStore.ts';
import type { ApiRequest, KeyValue } from '../../domain/request.ts';
import { AuthEditor } from '../requests/AuthEditor.tsx';
import { KeyValueEditor } from '../../shared/components/KeyValueEditor.tsx';

type ReceivedEvent = SseEvent & {
  key: string;
  receivedAt: string;
};

type StreamStats = {
  events: number;
  bytes: number;
  reconnects: number;
  connectedAt: number | null;
};

const emptyStats = (): StreamStats => ({ events: 0, bytes: 0, reconnects: 0, connectedAt: null });
const MAX_EVENTS = 1000;

function stopMessage(reason: SseStopReason, outcome: SseAttemptOutcome) {
  if (reason === 'noContent') return t('The server returned 204 No Content; not reconnecting.');
  if (reason === 'httpStatus') return t('The server returned HTTP {status}; not reconnecting.', { status: outcome.status ?? 0 });
  return t('The response is not text/event-stream ({type}); not reconnecting.', { type: outcome.contentType || '-' });
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

const row = (key = '', value = '', enabled = true): KeyValue => ({
  id: createId('kv'),
  key,
  value,
  enabled,
});

const starterRequest = (): ApiRequest => ({
  id: createId('sse'),
  name: 'SSE',
  method: 'GET',
  url: 'https://example.com/events',
  params: [row()],
  headers: [row('Accept', 'text/event-stream'), row('Cache-Control', 'no-cache'), row()],
  bodyType: 'none',
  body: '',
  formFields: [row()],
  multipartFields: [{ id: createId('mp'), key: '', value: '', enabled: true, kind: 'text' }],
  auth: { type: 'none' },
});

export function SsePanel() {
  useLocale();
  const environmentProfiles = useAppStore((state) => state.environmentProfiles);
  const activeEnvironmentId = useAppStore((state) => state.activeEnvironmentId);
  const environment = useMemo(
    () => getActiveEnvironmentValues({ environmentProfiles, activeEnvironmentId }),
    [environmentProfiles, activeEnvironmentId],
  );
  const networkSettings = useAppStore((state) => state.networkSettings);

  const [request, setRequest] = useState<ApiRequest>(() => starterRequest());
  const [operationId, setOperationId] = useState<string | null>(null);
  const [opened, setOpened] = useState<SseOpened | null>(null);
  const [events, setEvents] = useState<ReceivedEvent[]>([]);
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'headers' | 'auth'>('headers');
  const [streamTab, setStreamTab] = useState<'events' | 'raw'>('events');
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [reconnectDelay, setReconnectDelay] = useState(1000);
  const [stats, setStats] = useState<StreamStats>(emptyStats);
  const [lastEventId, setLastEventId] = useState('');
  const [waitingUntil, setWaitingUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const keepConnected = useRef(false);
  // The reconnect loop reads settings through refs so changes apply mid-session.
  const autoReconnectRef = useRef(autoReconnect);
  const reconnectDelayRef = useRef(reconnectDelay);
  const lastEventIdRef = useRef('');
  const pendingWait = useRef<{ timer: number; resolve: () => void } | null>(null);
  autoReconnectRef.current = autoReconnect;
  reconnectDelayRef.current = reconnectDelay;

  const running = operationId !== null || waitingUntil !== null;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => () => {
    keepConnected.current = false;
    pendingWait.current?.resolve();
  }, []);
  const connectionLabel = useMemo(() => {
    if (!running) return t('Disconnected');
    if (waitingUntil !== null) return t('Reconnecting in {seconds}s…', { seconds: Math.max(0, Math.ceil((waitingUntil - now) / 1000)) });
    return opened ? t('Connected') : t('Connecting…');
  }, [opened, running, waitingUntil, now]);

  const wait = (ms: number) => new Promise<void>((resolve) => {
    setWaitingUntil(Date.now() + ms);
    const done = () => {
      window.clearTimeout(pendingWait.current?.timer);
      pendingWait.current = null;
      setWaitingUntil(null);
      resolve();
    };
    pendingWait.current = { timer: window.setTimeout(done, ms), resolve: done };
  });

  const updateRequest = (updater: (current: ApiRequest) => ApiRequest) => {
    setRequest((current) => updater(current));
  };

  const connect = async () => {
    if (running) return;
    if (!isTauriRuntime()) {
      setError(t('SSE streaming requires the ApiForge desktop app.'));
      return;
    }
    keepConnected.current = true;
    lastEventIdRef.current = '';
    setLastEventId('');
    setOpened(null);
    setEvents([]);
    setRawText('');
    setError(null);
    setStats(emptyStats());

    let failures = 0;
    let attempt = 0;
    while (keepConnected.current) {
      const currentOperationId = createId('sse-op');
      const outcome: SseAttemptOutcome = {};
      setOperationId(currentOperationId);
      setOpened(null);
      if (attempt > 0) setStats((current) => ({ ...current, reconnects: current.reconnects + 1 }));
      attempt += 1;

      const engineRequest = toEngineRequest(
        { ...request, method: 'GET', bodyType: 'none', body: '' },
        environment,
        networkSettings,
      );
      if (!Object.keys(engineRequest.headers).some((key) => key.toLowerCase() === 'accept')) engineRequest.headers.Accept = 'text/event-stream';
      if (lastEventIdRef.current) engineRequest.headers['Last-Event-ID'] = lastEventIdRef.current;

      try {
        await streamSse(engineRequest, currentOperationId, {
          onOpen: (value) => {
            outcome.status = value.status;
            outcome.contentType = Object.entries(value.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
            setOpened(value);
            if (isSseResponseOk(outcome)) {
              setStats((current) => ({ ...current, connectedAt: Date.now() }));
            } else {
              // Fatal response: stop reading the body; the reconnect plan reports why.
              void cancelSse(currentOperationId).catch(() => undefined);
            }
          },
          onEvent: (event) => {
            if (event.id !== undefined) {
              lastEventIdRef.current = event.id;
              setLastEventId(event.id);
            }
            if (event.retry !== undefined) setReconnectDelay(Math.max(100, event.retry));
            setStats((current) => ({ ...current, events: current.events + 1 }));
            setEvents((current) => [
              ...current.slice(-(MAX_EVENTS - 1)),
              { ...event, key: createId('sse-event'), receivedAt: new Date().toLocaleTimeString() },
            ]);
          },
          onRawText: (text) => {
            setStats((current) => ({ ...current, bytes: current.bytes + new TextEncoder().encode(text).length }));
            setRawText((current) => (current + text).slice(-524_288));
          },
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (!message.toLowerCase().includes('cancel')) setError(message);
      }

      setStats((current) => ({ ...current, connectedAt: null }));
      const succeeded = outcome.status !== undefined && isSseResponseOk(outcome);
      const plan = planSseReconnect(outcome, {
        autoReconnect: autoReconnectRef.current,
        stopped: !keepConnected.current,
        retryMs: reconnectDelayRef.current,
        failures: succeeded ? 0 : failures,
      });
      failures = succeeded ? 0 : failures + 1;
      if (!plan.reconnect) {
        if (plan.reason) setError(stopMessage(plan.reason, outcome));
        break;
      }
      setOperationId(null);
      await wait(plan.delayMs);
    }
    keepConnected.current = false;
    setOperationId(null);
  };

  const disconnect = async () => {
    keepConnected.current = false;
    pendingWait.current?.resolve();
    if (operationId) await cancelSse(operationId).catch(() => undefined);
  };

  return (
    <section className="sse-page">
      <header className="page-header">
        <div>
          <strong>{t('Server-Sent Events')}</strong>
          <span>{t('Stream SSE through the native HTTP engine with shared TLS, proxy, cookies, and environment settings.')}</span>
        </div>
        <div className="sse-status">
          <span className={`sse-status-dot ${opened ? 'connected' : running ? 'connecting' : ''}`} />
          {connectionLabel}
        </div>
      </header>

      <div className="sse-url-row">
        <Radio size={16} />
        <input
          value={request.url}
          disabled={running}
          onChange={(event) => updateRequest((current) => ({ ...current, url: event.target.value }))}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              void (running ? disconnect() : connect());
            }
          }}
          placeholder="https://example.com/events"
          spellCheck={false}
        />
        <button
          className={`send-button ${running ? 'cancel-button' : ''}`}
          onClick={() => void (running ? disconnect() : connect())}
        >
          {running ? <Square size={15} /> : <Radio size={16} />}
          {running ? t('Disconnect') : t('Connect')}
        </button>
      </div>

      <div className="sse-layout">
        <aside className="sse-settings">
          <div className="tabs">
            <button className={sideTab === 'headers' ? 'active' : ''} onClick={() => setSideTab('headers')}>
              {t('Headers')}
            </button>
            <button className={sideTab === 'auth' ? 'active' : ''} onClick={() => setSideTab('auth')}>
              {t('Authorization')}
            </button>
          </div>
          <div className="sse-settings-content">
            {sideTab === 'headers' ? (
              <KeyValueEditor
                rows={request.headers}
                onChange={(headers) => updateRequest((current) => ({ ...current, headers }))}
              />
            ) : (
              <AuthEditor
                request={request}
                onChange={(auth) => updateRequest((current) => ({ ...current, auth }))}
              />
            )}
          </div>
          {opened && (
            <div className="sse-open-info">
              <strong>{opened.status} {opened.statusText}</strong>
              <span>{t('{count} response headers', { count: Object.keys(opened.headers).length })}</span>
            </div>
          )}
          <dl className="sse-stats">
            <div><dt>{t('Connected for')}</dt><dd>{stats.connectedAt ? formatDuration(now - stats.connectedAt) : '-'}</dd></div>
            <div><dt>{t('Events')}</dt><dd>{stats.events}</dd></div>
            <div><dt>{t('Bytes received')}</dt><dd>{stats.bytes.toLocaleString()} B</dd></div>
            <div><dt>{t('Reconnects')}</dt><dd>{stats.reconnects}</dd></div>
            <div className="sse-stats-wide"><dt>Last-Event-ID</dt><dd title={lastEventId}>{lastEventId || '-'}</dd></div>
          </dl>
          <div className="sse-reconnect-settings">
            <label><input type="checkbox" checked={autoReconnect} onChange={(event) => setAutoReconnect(event.target.checked)} />{t('Reconnect automatically')}</label>
            <label>{t('Retry delay (ms)')}<input type="number" min={100} max={60000} value={reconnectDelay} onChange={(event) => setReconnectDelay(Math.max(100, Number(event.target.value) || 1000))} /></label>
          </div>
        </aside>

        <main className="sse-stream">
          <div className="sse-stream-toolbar">
            <div className="tabs">
              <button className={streamTab === 'events' ? 'active' : ''} onClick={() => setStreamTab('events')}>
                {t('Events')} <span>{events.length}</span>
              </button>
              <button className={streamTab === 'raw' ? 'active' : ''} onClick={() => setStreamTab('raw')}>
                {t('Raw stream')}
              </button>
            </div>
            <button
              className="secondary-button compact"
              disabled={!events.length && !rawText}
              onClick={() => {
                setEvents([]);
                setRawText('');
              }}
            >
              <Trash2 size={13} /> {t('Clear')}
            </button>
          </div>

          {error && <div className="sse-error">{error}</div>}

          {streamTab === 'events' ? (
            <div className="sse-event-list">
              {events.length === 0 ? (
                <div className="page-empty">
                  <strong>{t('No SSE events yet')}</strong>
                  <span>{t('Connect to an SSE endpoint to watch events arrive live.')}</span>
                </div>
              ) : events.map((event, index) => (
                <article className="sse-event-card" key={event.key}>
                  <header>
                    <span>#{index + 1}</span>
                    <strong>{event.event}</strong>
                    {event.id && <code>id: {event.id}</code>}
                    {event.retry !== undefined && <code>retry: {event.retry}</code>}
                    <time>{event.receivedAt}</time>
                  </header>
                  <pre>{event.data}</pre>
                </article>
              ))}
            </div>
          ) : (
            <pre className="sse-raw">{rawText || t('Raw SSE bytes will appear here as UTF-8 text.')}</pre>
          )}
        </main>
      </div>
    </section>
  );
}
