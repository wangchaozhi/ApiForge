import { Radio, Square, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import { createId } from '../lib/id';
import { toEngineRequest } from '../lib/request';
import { cancelSse, streamSse, type SseEvent, type SseOpened } from '../lib/sse';
import { getActiveEnvironmentValues, useAppStore } from '../store/appStore';
import type { ApiRequest, KeyValue } from '../types/api';
import { AuthEditor } from './AuthEditor';
import { KeyValueEditor } from './KeyValueEditor';

type ReceivedEvent = SseEvent & {
  key: string;
  receivedAt: string;
};

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
  const environment = useAppStore(getActiveEnvironmentValues);
  const networkSettings = useAppStore((state) => state.networkSettings);

  const [request, setRequest] = useState<ApiRequest>(() => starterRequest());
  const [operationId, setOperationId] = useState<string | null>(null);
  const [opened, setOpened] = useState<SseOpened | null>(null);
  const [events, setEvents] = useState<ReceivedEvent[]>([]);
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'headers' | 'auth'>('headers');
  const [streamTab, setStreamTab] = useState<'events' | 'raw'>('events');

  const running = operationId !== null;
  const connectionLabel = useMemo(() => {
    if (!running) return t('Disconnected');
    return opened ? t('Connected') : t('Connecting…');
  }, [opened, running]);

  const updateRequest = (updater: (current: ApiRequest) => ApiRequest) => {
    setRequest((current) => updater(current));
  };

  const connect = async () => {
    if (running) return;
    const nextOperationId = createId('sse-op');
    setOperationId(nextOperationId);
    setOpened(null);
    setEvents([]);
    setRawText('');
    setError(null);

    const engineRequest = toEngineRequest(
      { ...request, method: 'GET', bodyType: 'none', body: '' },
      environment,
      networkSettings,
    );

    if (!Object.keys(engineRequest.headers).some((key) => key.toLowerCase() === 'accept')) {
      engineRequest.headers.Accept = 'text/event-stream';
    }

    try {
      await streamSse(engineRequest, nextOperationId, {
        onOpen: (value) => setOpened(value),
        onEvent: (event) => {
          setEvents((current) => [
            ...current.slice(-999),
            {
              ...event,
              key: createId('sse-event'),
              receivedAt: new Date().toLocaleTimeString(),
            },
          ]);
        },
        onRawText: (text) => {
          setRawText((current) => (current + text).slice(-524_288));
        },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!message.toLowerCase().includes('cancel')) setError(message);
    } finally {
      setOperationId((current) => current === nextOperationId ? null : current);
    }
  };

  const disconnect = async () => {
    if (!operationId) return;
    await cancelSse(operationId).catch(() => undefined);
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
