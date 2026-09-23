import { FileUp, Play, Waypoints } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import { inspectGrpcDescriptor, invokeGrpc, type GrpcServiceInfo } from '../lib/grpc';
import { createId } from '../lib/id';
import { interpolate } from '../lib/request';
import { getActiveEnvironmentValues, useAppStore } from '../store/appStore';
import type { KeyValue } from '../types/api';
import { KeyValueEditor } from './KeyValueEditor';

const row = (): KeyValue => ({ id: createId('kv'), key: '', value: '', enabled: true });

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
  const [responses, setResponses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const service = services.find((item) => item.name === serviceName);
  const method = service?.methods.find((item) => item.name === methodName);

  const chooseDescriptor = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: false, directory: false, filters: [{ name: 'Protobuf descriptor set', extensions: ['bin', 'pb', 'protoset'] }] });
    if (typeof selected !== 'string') return;
    try {
      const loaded = await inspectGrpcDescriptor(selected);
      setDescriptorPath(selected);
      setServices(loaded);
      const firstService = loaded[0];
      setServiceName(firstService?.name ?? '');
      setMethodName(firstService?.methods[0]?.name ?? '');
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const run = async () => {
    if (!descriptorPath || !serviceName || !methodName) return;
    setBusy(true); setError(null); setResponses([]);
    try {
      const result = await invokeGrpc({
        endpoint: interpolate(endpoint, variables), descriptorPath, service: serviceName, method: methodName,
        requestJson: interpolate(requestJson, variables),
        metadata: metadata.filter((item) => item.enabled && item.key).map((item) => ({ key: interpolate(item.key, variables), value: interpolate(item.value, variables) })),
        network,
      });
      setResponses(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return (
    <section className="grpc-page">
      <header className="page-header"><div><strong>{t('gRPC')}</strong><span>{t('Invoke unary and server-streaming methods from a protobuf descriptor set.')}</span></div><button className="secondary-button compact" onClick={() => void chooseDescriptor()}><FileUp size={13} />{t('Import descriptor')}</button></header>
      <div className="grpc-toolbar"><Waypoints size={16} /><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} spellCheck={false} /><select value={serviceName} onChange={(event) => { const name = event.target.value; setServiceName(name); setMethodName(services.find((item) => item.name === name)?.methods[0]?.name ?? ''); }}><option value="">{t('Service')}</option>{services.map((item) => <option key={item.name}>{item.name}</option>)}</select><select value={methodName} onChange={(event) => setMethodName(event.target.value)}><option value="">{t('Method')}</option>{service?.methods.map((item) => <option key={item.name}>{item.name}</option>)}</select><button className="send-button" disabled={busy || !method} onClick={() => void run()}><Play size={14} />{busy ? t('Running…') : t('Invoke')}</button></div>
      <div className="grpc-grid"><div className="grpc-editor"><div className="graphql-section-heading"><strong>{t('Request JSON')}</strong>{method && <span>{method.clientStreaming ? t('Client streaming') : method.serverStreaming ? t('Server streaming') : t('Unary')}</span>}</div><textarea value={requestJson} onChange={(event) => setRequestJson(event.target.value)} spellCheck={false} /></div><div className="grpc-metadata"><div className="graphql-section-heading"><strong>{t('Metadata')}</strong></div><KeyValueEditor rows={metadata} onChange={setMetadata} /></div><div className="grpc-response"><div className="graphql-response-heading"><strong>{t('Responses')}</strong><span>{responses.length}</span></div>{error ? <pre className="graphql-error">{error}</pre> : <pre>{responses.join('\n\n')}</pre>}</div></div>
    </section>
  );
}
