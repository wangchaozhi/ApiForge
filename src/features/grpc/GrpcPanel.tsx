import { FileUp, Play, Send, Square, StopCircle, Trash2, WandSparkles, Waypoints } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t, useLocale } from '../../i18n/index.ts';
import type { MessageKey } from '../../i18n/messages.ts';
import {
  cancelGrpc, finishGrpcStream, GRPC_DESCRIPTOR_EXTENSIONS, grpcCallKind, inspectGrpcDescriptor,
  sendGrpcMessage, startGrpc, type GrpcCallKind, type GrpcMethodInfo, type GrpcNativeEvent, type GrpcServiceInfo, type GrpcSummary,
} from '../../services/grpc.ts';
import { createId } from '../../lib/id.ts';
import { interpolate } from '../../services/http/buildRequest.ts';
import { getActiveEnvironmentValues, useAppStore } from '../../store/appStore.ts';
import type { KeyValue } from '../../domain/request.ts';
import { KeyValueEditor } from '../../shared/components/KeyValueEditor.tsx';

type TimelineEvent = GrpcNativeEvent | { type: 'sent'; data: string };
type TimelineItem = TimelineEvent & { key: string; timestamp: string };

const MAX_TIMELINE_ITEMS = 1000;
const row = (): KeyValue => ({ id: createId('kv'), key: '', value: '', enabled: true });
const kindLabels: Record<GrpcCallKind, MessageKey> = {
  unary: 'Unary',
  serverStreaming: 'Server streaming',
  clientStreaming: 'Client streaming',
  bidiStreaming: 'Bidirectional streaming',
};
const itemTitles: Record<TimelineItem['type'], MessageKey> = {
  headers: 'Response headers',
  message: 'Incoming',
  trailers: 'Trailers',
  sent: 'Outgoing',
};
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function GrpcPanel() {
  useLocale();
  const profiles = useAppStore((state) => state.environmentProfiles);
  const activeEnvironmentId = useAppStore((state) => state.activeEnvironmentId);
  const variables = useMemo(() => getActiveEnvironmentValues({ environmentProfiles: profiles, activeEnvironmentId }), [profiles, activeEnvironmentId]);
  const network = useAppStore((state) => state.networkSettings);
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:50051');
  const [descriptorPath, setDescriptorPath] = useState('');
  const [services, setServices] = useState<GrpcServiceInfo[]>([]);
  const [serviceName, setServiceName] = useState('');
  const [methodName, setMethodName] = useState('');
  const [metadata, setMetadata] = useState<KeyValue[]>([row()]);
  const [requestJson, setRequestJson] = useState('{}');
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [summary, setSummary] = useState<GrpcSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [streamOpen, setStreamOpen] = useState(false);

  const service = services.find((item) => item.name === serviceName);
  const method = service?.methods.find((item) => item.name === methodName);
  const kind = method ? grpcCallKind(method) : null;
  const clientStreams = kind === 'clientStreaming' || kind === 'bidiStreaming';

  const record = (event: TimelineEvent) => {
    setTimeline((current) => [...current.slice(-(MAX_TIMELINE_ITEMS - 1)), { ...event, key: createId('grpc-event'), timestamp: new Date().toLocaleTimeString() }]);
  };

  const selectMethod = (next: GrpcMethodInfo | undefined) => {
    const previousTemplate = method?.requestTemplate;
    setMethodName(next?.name ?? '');
    // Replace the editor only when it still holds an untouched template.
    const untouched = !requestJson.trim() || requestJson.trim() === '{}' || requestJson === previousTemplate;
    if (next && untouched) setRequestJson(next.requestTemplate);
  };

  const chooseDescriptor = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: false, directory: false, filters: [{ name: t('Protobuf schema'), extensions: GRPC_DESCRIPTOR_EXTENSIONS }] });
    if (typeof selected !== 'string') return;
    try {
      const loaded = await inspectGrpcDescriptor(selected);
      setDescriptorPath(selected);
      setServices(loaded);
      const firstService = loaded[0];
      setServiceName(firstService?.name ?? '');
      const firstMethod = firstService?.methods[0];
      setMethodName(firstMethod?.name ?? '');
      setRequestJson(firstMethod?.requestTemplate ?? '{}');
      setError(loaded.length ? null : t('The schema does not define any services.'));
    } catch (cause) { setError(errorText(cause)); }
  };

  const reloadDescriptor = async () => {
    if (!descriptorPath) return;
    try {
      const loaded = await inspectGrpcDescriptor(descriptorPath);
      setServices(loaded);
      setError(null);
    } catch (cause) { setError(errorText(cause)); }
  };

  const run = async () => {
    if (!descriptorPath || !serviceName || !method || operationId) return;
    const id = createId('grpc-op');
    const firstMessage = interpolate(requestJson, variables);
    setOperationId(id);
    setStreamOpen(clientStreams);
    setError(null);
    setSummary(null);
    setTimeline([]);
    if (clientStreams && firstMessage.trim()) record({ type: 'sent', data: firstMessage });
    try {
      const result = await startGrpc({
        endpoint: interpolate(endpoint, variables), descriptorPath, service: serviceName, method: method.name,
        requestJson: firstMessage,
        metadata: metadata.filter((item) => item.enabled && item.key).map((item) => ({ key: interpolate(item.key, variables), value: interpolate(item.value, variables) })),
        network,
      }, id, record);
      setSummary(result);
    } catch (cause) {
      const text = errorText(cause);
      setError(text.toLowerCase().includes('cancel') ? t('Call cancelled.') : text);
    } finally {
      setStreamOpen(false);
      setOperationId((current) => current === id ? null : current);
    }
  };

  const sendMessage = async () => {
    if (!operationId || !streamOpen) return;
    const payload = interpolate(requestJson, variables);
    try {
      await sendGrpcMessage(operationId, payload);
      record({ type: 'sent', data: payload });
      setError(null);
    } catch (cause) { setError(errorText(cause)); }
  };

  const endStream = async () => {
    if (!operationId) return;
    await finishGrpcStream(operationId).catch(() => undefined);
    setStreamOpen(false);
  };

  const cancel = async () => {
    if (operationId) await cancelGrpc(operationId).catch(() => undefined);
  };

  const runLabel = clientStreams ? t('Start stream') : t('Invoke');

  return (
    <section className="grpc-page">
      <header className="page-header"><div><strong>{t('gRPC')}</strong><span>{descriptorPath ? fileName(descriptorPath) : t('Import a .proto file or a descriptor set to call unary and streaming methods.')}</span></div><div className="grpc-header-actions">{descriptorPath && <button className="secondary-button compact" disabled={!!operationId} onClick={() => void reloadDescriptor()}>{t('Reload')}</button>}<button className="secondary-button compact" disabled={!!operationId} onClick={() => void chooseDescriptor()}><FileUp size={13} />{t('Import schema')}</button></div></header>
      <div className="grpc-toolbar">
        <Waypoints size={16} />
        <input value={endpoint} disabled={!!operationId} onChange={(event) => setEndpoint(event.target.value)} spellCheck={false} placeholder="https://host:443" />
        <select value={serviceName} disabled={!!operationId} onChange={(event) => { const name = event.target.value; setServiceName(name); selectMethod(services.find((item) => item.name === name)?.methods[0]); }}><option value="">{t('Service')}</option>{services.map((item) => <option key={item.name}>{item.name}</option>)}</select>
        <select value={methodName} disabled={!!operationId} onChange={(event) => selectMethod(service?.methods.find((item) => item.name === event.target.value))}><option value="">{t('Method')}</option>{service?.methods.map((item) => <option key={item.name}>{item.name}</option>)}</select>
        {operationId
          ? <button className="send-button cancel-button" onClick={() => void cancel()}><Square size={14} />{t('Cancel')}</button>
          : <button className="send-button" disabled={!method} onClick={() => void run()}><Play size={14} />{runLabel}</button>}
      </div>
      <div className="grpc-grid">
        <div className="grpc-editor">
          <div className="graphql-section-heading"><strong>{clientStreams ? t('Message JSON') : t('Request JSON')}</strong>{method && <span title={`${method.inputType} → ${method.outputType}`}>{kind && t(kindLabels[kind])} · {method.inputType}</span>}<button className="secondary-button compact" disabled={!method} onClick={() => method && setRequestJson(method.requestTemplate)}><WandSparkles size={12} />{t('Template')}</button></div>
          <textarea value={requestJson} onChange={(event) => setRequestJson(event.target.value)} spellCheck={false} />
          {clientStreams && <div className="grpc-stream-actions"><span>{streamOpen ? t('Request stream open') : operationId ? t('Request stream closed') : t('The editor content is sent as the first message when the stream starts.')}</span><button className="secondary-button compact" disabled={!streamOpen} onClick={() => void endStream()}><StopCircle size={13} />{t('End stream')}</button><button className="primary-button compact" disabled={!streamOpen} onClick={() => void sendMessage()}><Send size={13} />{t('Send message')}</button></div>}
        </div>
        <div className="grpc-metadata"><div className="graphql-section-heading"><strong>{t('Metadata')}</strong><span>{t('Keys ending in -bin take Base64 values.')}</span></div><KeyValueEditor rows={metadata} onChange={setMetadata} /></div>
        <div className="grpc-response">
          <div className="graphql-response-heading"><strong>{t('Responses')}</strong><span>{summary ? t('{count} messages · {elapsed} ms', { count: summary.messageCount, elapsed: summary.elapsedMs }) : operationId ? t('Running…') : ''}</span><button className="secondary-button compact" disabled={!timeline.length || !!operationId} onClick={() => { setTimeline([]); setSummary(null); }}><Trash2 size={13} />{t('Clear')}</button></div>
          {error && <pre className="graphql-error">{error}</pre>}
          <div className="sse-event-list">{timeline.length ? timeline.map((item) => (
            <article className={`sse-event-card grpc-event grpc-${item.type}`} key={item.key}>
              <header><strong>{t(itemTitles[item.type])}</strong><time>{item.timestamp}</time></header>
              <pre>{'data' in item ? item.data : Object.entries(item.metadata).map(([key, value]) => `${key}: ${value}`).join('\n') || '—'}</pre>
            </article>
          )) : !error && <div className="page-empty"><strong>{t('No responses yet')}</strong><span>{t('Pick a method and invoke it to see responses here.')}</span></div>}</div>
        </div>
      </div>
    </section>
  );
}
