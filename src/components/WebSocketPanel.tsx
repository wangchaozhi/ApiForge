import { Braces, PlugZap, Send, Square, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import { createId } from '../lib/id';
import { toEngineRequest } from '../lib/request';
import { connectWebSocket, disconnectWebSocket, sendWebSocketMessage, type WebSocketNativeEvent } from '../lib/websocket';
import { getActiveEnvironmentValues, useAppStore } from '../store/appStore';
import type { ApiRequest, KeyValue } from '../types/api';
import { AuthEditor } from './AuthEditor';
import { KeyValueEditor } from './KeyValueEditor';

type TimelineItem = WebSocketNativeEvent & { key: string; timestamp: string };
const row = (key = '', value = ''): KeyValue => ({ id: createId('kv'), key, value, enabled: true });
const starterRequest = (): ApiRequest => ({
  id: createId('ws'), name: 'WebSocket', method: 'GET', url: 'wss://echo.websocket.org',
  params: [row()], headers: [row()], bodyType: 'none', body: '', formFields: [row()],
  multipartFields: [{ id: createId('mp'), key: '', value: '', enabled: true, kind: 'text' }],
  auth: { type: 'none' },
});

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
  const [binary, setBinary] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'headers' | 'auth'>('headers');

  const record = (event: WebSocketNativeEvent) => {
    setTimeline((current) => [...current.slice(-999), { ...event, key: createId('ws-message'), timestamp: new Date().toLocaleTimeString() }]);
    if (event.type === 'opened') setConnected(true);
    if (event.type === 'closed') setConnected(false);
  };

  const connect = async () => {
    if (operationId) return;
    const id = createId('ws-op');
    setOperationId(id);
    setError(null);
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

  const send = async () => {
    if (!operationId || !message) return;
    try {
      await sendWebSocketMessage(operationId, message, binary);
      record({ type: 'message', operationId, data: message, binary });
      setMessage('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const formatJson = () => {
    try { setMessage(JSON.stringify(JSON.parse(message), null, 2)); } catch { setError(t('Message is not valid JSON.')); }
  };

  return (
    <section className="sse-page websocket-page">
      <header className="page-header"><div><strong>{t('WebSocket')}</strong><span>{t('Open a native WebSocket session and inspect its message timeline.')}</span></div><div className="sse-status"><span className={`sse-status-dot ${connected ? 'connected' : operationId ? 'connecting' : ''}`} />{connected ? t('Connected') : operationId ? t('Connecting…') : t('Disconnected')}</div></header>
      <div className="sse-url-row"><PlugZap size={16} /><input value={request.url} disabled={!!operationId} onChange={(event) => setRequest((current) => ({ ...current, url: event.target.value }))} spellCheck={false} /><button className={`send-button ${operationId ? 'cancel-button' : ''}`} onClick={() => void (operationId ? disconnect() : connect())}>{operationId ? <Square size={15} /> : <PlugZap size={15} />}{operationId ? t('Disconnect') : t('Connect')}</button></div>
      <div className="sse-layout">
        <aside className="sse-settings"><div className="tabs"><button className={sideTab === 'headers' ? 'active' : ''} onClick={() => setSideTab('headers')}>{t('Headers')}</button><button className={sideTab === 'auth' ? 'active' : ''} onClick={() => setSideTab('auth')}>{t('Authorization')}</button></div><div className="sse-settings-content">{sideTab === 'headers' ? <KeyValueEditor rows={request.headers} onChange={(headers) => setRequest((current) => ({ ...current, headers }))} /> : <AuthEditor request={request} onChange={(auth) => setRequest((current) => ({ ...current, auth }))} />}</div></aside>
        <main className="sse-stream">
          <div className="sse-stream-toolbar"><strong>{t('Message timeline')}</strong><button className="secondary-button compact" onClick={() => setTimeline([])} disabled={!timeline.length}><Trash2 size={13} />{t('Clear')}</button></div>
          {error && <div className="sse-error">{error}</div>}
          <div className="sse-event-list">{timeline.length ? timeline.map((item) => <article className="sse-event-card" key={item.key}><header><strong>{item.type}</strong>{item.type === 'message' && <code>{item.binary ? t('Binary') : t('Text')}</code>}<time>{item.timestamp}</time></header>{'data' in item && <pre>{item.data}</pre>}{item.type === 'closed' && <pre>{item.code ?? ''} {item.reason}</pre>}</article>) : <div className="page-empty"><strong>{t('No WebSocket messages yet')}</strong><span>{t('Connect and send a message to begin.')}</span></div>}</div>
          <div className="websocket-composer"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t('Message payload')} /><div><label><input type="checkbox" checked={binary} onChange={(event) => setBinary(event.target.checked)} />{t('Binary')}</label><button className="secondary-button compact" onClick={formatJson}><Braces size={13} />{t('Format JSON')}</button><button className="primary-button compact" disabled={!connected || !message} onClick={() => void send()}><Send size={13} />{t('Send')}</button></div></div>
        </main>
      </div>
    </section>
  );
}
