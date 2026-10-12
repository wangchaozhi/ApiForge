import { ArrowDownLeft, ArrowUpRight, Braces, HeartPulse, PlugZap, Send, Square, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t, useLocale } from '../../i18n/index.ts';
import { createId } from '../../lib/id.ts';
import { toEngineRequest } from '../../services/http/buildRequest.ts';
import {
  connectWebSocket, disconnectWebSocket, sendWebSocketMessage, validateOutgoing,
  type WebSocketNativeEvent, type WebSocketSendKind,
} from '../../services/websocket.ts';
import { getActiveEnvironmentValues, useAppStore } from '../../store/appStore.ts';
import type { ApiRequest, KeyValue } from '../../domain/request.ts';
import { AuthEditor } from '../requests/AuthEditor.tsx';
import { KeyValueEditor } from '../../shared/components/KeyValueEditor.tsx';

type TimelineItem = WebSocketNativeEvent & { key: string; timestamp: string };
type Counters = { sent: number; received: number };

const MAX_TIMELINE_ITEMS = 1000;
const row = (key = '', value = ''): KeyValue => ({ id: createId('kv'), key, value, enabled: true });
const starterRequest = (): ApiRequest => ({
  id: createId('ws'), name: 'WebSocket', method: 'GET', url: 'wss://echo.websocket.org',
  params: [row()], headers: [row()], bodyType: 'none', body: '', formFields: [row()],
  multipartFields: [{ id: createId('mp'), key: '', value: '', enabled: true, kind: 'text' }],
  auth: { type: 'none' },
});

function describe(item: TimelineItem) {
  switch (item.type) {
    case 'opened': return { title: t('Connected'), direction: null, detail: `${item.status}${item.protocol ? ` · ${item.protocol}` : ''}` };
    case 'message': return { title: t('Incoming'), direction: 'in' as const, detail: item.binary ? t('Binary (Base64)') : t('Text') };
    case 'sent': return { title: t('Outgoing'), direction: 'out' as const, detail: item.kind === 'binary' ? t('Binary (Base64)') : item.kind === 'ping' ? 'ping' : t('Text') };
    case 'ping': case 'pong': return { title: item.type, direction: 'in' as const, detail: '' };
    case 'closed': return { title: t('Closed'), direction: null, detail: item.code == null ? '' : String(item.code) };
  }
}

export function WebSocketPanel() {
  useLocale();
  const environmentProfiles = useAppStore((state) => state.environmentProfiles);
  const activeEnvironmentId = useAppStore((state) => state.activeEnvironmentId);
  const environment = useMemo(
    () => getActiveEnvironmentValues({ environmentProfiles, activeEnvironmentId }),
    [environmentProfiles, activeEnvironmentId],
  );
  const network = useAppStore((state) => state.networkSettings);
  const [request, setRequest] = useState(starterRequest);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<Exclude<WebSocketSendKind, 'ping'>>('text');
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [counters, setCounters] = useState<Counters>({ sent: 0, received: 0 });
  const [error, setError] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'headers' | 'auth'>('headers');

  const record = (event: WebSocketNativeEvent) => {
    setTimeline((current) => [...current.slice(-(MAX_TIMELINE_ITEMS - 1)), { ...event, key: createId('ws-message'), timestamp: new Date().toLocaleTimeString() }]);
    if (event.type === 'sent') setCounters((current) => ({ ...current, sent: current.sent + 1 }));
    if (event.type === 'message') setCounters((current) => ({ ...current, received: current.received + 1 }));
    if (event.type === 'opened') setConnected(true);
    if (event.type === 'closed') setConnected(false);
  };

  const connect = async () => {
    if (operationId) return;
    const id = createId('ws-op');
    setOperationId(id);
    setError(null);
    setCounters({ sent: 0, received: 0 });
    try {
      await connectWebSocket(toEngineRequest(request, environment, network), id, { onEvent: record });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      if (!text.toLowerCase().includes('cancel')) setError(text);
    } finally {
      setConnected(false);
      setOperationId((current) => current === id ? null : current);
    }
  };

  const disconnect = async () => {
    if (operationId) await disconnectWebSocket(operationId).catch(() => undefined);
  };

  const send = async (sendKind: WebSocketSendKind, payload: string) => {
    if (!operationId) return;
    const problem = validateOutgoing(sendKind, payload);
    if (problem) {
      setError(t(problem));
      return;
    }
    try {
      setError(null);
      await sendWebSocketMessage(operationId, payload, sendKind);
      if (sendKind !== 'ping') setMessage('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const formatJson = () => {
    try { setMessage(JSON.stringify(JSON.parse(message), null, 2)); } catch { setError(t('Message is not valid JSON.')); }
  };

  const status = connected ? t('Connected') : operationId ? t('Connecting…') : t('Disconnected');

  return (
    <section className="sse-page websocket-page">
      <header className="page-header"><div><strong>{t('WebSocket')}</strong><span>{t('Open a native WebSocket session and inspect its message timeline.')}</span></div><div className="sse-status"><span className={`sse-status-dot ${connected ? 'connected' : operationId ? 'connecting' : ''}`} />{status}</div></header>
      <div className="sse-url-row"><PlugZap size={16} /><input value={request.url} disabled={!!operationId} onChange={(event) => setRequest((current) => ({ ...current, url: event.target.value }))} spellCheck={false} /><button className={`send-button ${operationId ? 'cancel-button' : ''}`} onClick={() => void (operationId ? disconnect() : connect())}>{operationId ? <Square size={15} /> : <PlugZap size={15} />}{operationId ? (connected ? t('Disconnect') : t('Cancel')) : t('Connect')}</button></div>
      <div className="sse-layout">
        <aside className="sse-settings"><div className="tabs"><button className={sideTab === 'headers' ? 'active' : ''} onClick={() => setSideTab('headers')}>{t('Headers')}</button><button className={sideTab === 'auth' ? 'active' : ''} onClick={() => setSideTab('auth')}>{t('Authorization')}</button></div><div className="sse-settings-content">{sideTab === 'headers' ? <KeyValueEditor rows={request.headers} onChange={(headers) => setRequest((current) => ({ ...current, headers }))} /> : <AuthEditor request={request} onChange={(auth) => setRequest((current) => ({ ...current, auth }))} />}</div></aside>
        <main className="sse-stream">
          <div className="sse-stream-toolbar"><strong>{t('Message timeline')}</strong><div className="websocket-counters"><span><ArrowUpRight size={12} />{counters.sent}</span><span><ArrowDownLeft size={12} />{counters.received}</span><button className="secondary-button compact" onClick={() => setTimeline([])} disabled={!timeline.length}><Trash2 size={13} />{t('Clear')}</button></div></div>
          {error && <div className="sse-error">{error}</div>}
          <div className="sse-event-list">{timeline.length ? timeline.map((item) => {
            const info = describe(item);
            return (
              <article className={`sse-event-card websocket-event ${info.direction ? `websocket-${info.direction}` : ''}`} key={item.key}>
                <header>{info.direction === 'out' ? <ArrowUpRight size={12} /> : info.direction === 'in' ? <ArrowDownLeft size={12} /> : null}<strong>{info.title}</strong>{info.detail && <code>{info.detail}</code>}<time>{item.timestamp}</time></header>
                {'data' in item && item.data && <pre>{item.data}</pre>}
                {item.type === 'closed' && item.reason && <pre>{item.reason}</pre>}
                {item.type === 'opened' && Object.keys(item.headers).length > 0 && <pre>{Object.entries(item.headers).map(([key, value]) => `${key}: ${value}`).join('\n')}</pre>}
              </article>
            );
          }) : <div className="page-empty"><strong>{t('No WebSocket messages yet')}</strong><span>{t('Connect and send a message to begin.')}</span></div>}</div>
          <div className="websocket-composer">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={kind === 'binary' ? t('Base64 encoded bytes') : t('Message payload')} spellCheck={false} />
            <div>
              <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="text">{t('Text')}</option><option value="binary">{t('Binary (Base64)')}</option></select>
              <button className="secondary-button compact" onClick={formatJson} disabled={kind !== 'text'}><Braces size={13} />{t('Format JSON')}</button>
              <button className="secondary-button compact" disabled={!connected} onClick={() => void send('ping', '')}><HeartPulse size={13} />{t('Ping')}</button>
              <button className="primary-button compact" disabled={!connected || !message} onClick={() => void send(kind, message)}><Send size={13} />{t('Send')}</button>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
