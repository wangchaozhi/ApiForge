import { Braces, Send, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import { createId } from '../lib/id';
import { cancelApiRequest, sendApiRequest, toEngineRequest } from '../lib/request';
import { getActiveEnvironmentValues, useAppStore } from '../store/appStore';
import type { ApiRequest, ApiResponse, KeyValue } from '../types/api';
import { AuthEditor } from './AuthEditor';
import { CodeEditor } from './CodeEditor';
import { KeyValueEditor } from './KeyValueEditor';

const row = (key = '', value = '', enabled = true): KeyValue => ({ id: createId('kv'), key, value, enabled });

const starterRequest = (): ApiRequest => ({
  id: createId('graphql'),
  name: 'GraphQL',
  method: 'POST',
  url: 'https://api.example.com/graphql',
  params: [row()],
  headers: [row('Accept', 'application/json'), row()],
  bodyType: 'json',
  body: '',
  formFields: [row()],
  multipartFields: [{ id: createId('mp'), key: '', value: '', enabled: true, kind: 'text' }],
  auth: { type: 'none' },
});

function prettyBody(response: ApiResponse | null) {
  if (!response) return '';
  if (response.bodyEncoding === 'base64') return response.body;
  try {
    return JSON.stringify(JSON.parse(response.body), null, 2);
  } catch {
    return response.body;
  }
}

export function GraphqlPanel() {
  useLocale();
  const variables = useAppStore(getActiveEnvironmentValues);
  const networkSettings = useAppStore((state) => state.networkSettings);

  const [request, setRequest] = useState<ApiRequest>(() => starterRequest());
  const [query, setQuery] = useState('query Example {\n  __typename\n}');
  const [graphqlVariables, setGraphqlVariables] = useState('{}');
  const [operationName, setOperationName] = useState('');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'headers' | 'auth'>('headers');

  const sending = operationId !== null;
  const responseText = useMemo(() => prettyBody(response), [response]);

  const updateRequest = (updater: (current: ApiRequest) => ApiRequest) => {
    setRequest((current) => updater(current));
  };

  const send = async () => {
    let parsedVariables: unknown = {};
    try {
      parsedVariables = graphqlVariables.trim() ? JSON.parse(graphqlVariables) : {};
    } catch {
      setError(t('GraphQL variables must be valid JSON.'));
      return;
    }

    const nextOperationId = createId('graphql-op');
    setOperationId(nextOperationId);
    setError(null);
    try {
      const graphqlBody = JSON.stringify({
        query,
        variables: parsedVariables,
        ...(operationName.trim() ? { operationName: operationName.trim() } : {}),
      });
      const engineRequest = toEngineRequest({
        ...request,
        method: 'POST',
        bodyType: 'json',
        body: graphqlBody,
      }, variables, networkSettings);
      const nextResponse = await sendApiRequest(engineRequest, nextOperationId);
      setResponse(nextResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOperationId(null);
    }
  };

  const cancel = async () => {
    if (!operationId) return;
    await cancelApiRequest(operationId).catch(() => undefined);
  };

  return (
    <section className="graphql-page">
      <header className="page-header">
        <div>
          <strong>{t('GraphQL')}</strong>
          <span>{t('Send GraphQL operations through the same native HTTP engine.')}</span>
        </div>
      </header>

      <div className="graphql-url-row">
        <Braces size={16} />
        <input
          value={request.url}
          onChange={(event) => updateRequest((current) => ({ ...current, url: event.target.value }))}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void (sending ? cancel() : send());
          }}
          placeholder="https://api.example.com/graphql"
          spellCheck={false}
        />
        <button className={`send-button ${sending ? 'cancel-button' : ''}`} onClick={() => void (sending ? cancel() : send())}>
          {sending ? <Square size={15} /> : <Send size={16} />}
          {sending ? t('Cancel') : t('Send')}
        </button>
      </div>

      <div className="graphql-grid">
        <div className="graphql-editor-column">
          <div className="graphql-section-heading">
            <strong>{t('Query')}</strong>
            <input
              value={operationName}
              onChange={(event) => setOperationName(event.target.value)}
              placeholder={t('Operation name (optional)')}
              spellCheck={false}
            />
          </div>
          <CodeEditor value={query} language="plaintext" height="100%" onChange={setQuery} />
        </div>

        <div className="graphql-editor-column">
          <div className="graphql-section-heading"><strong>{t('Variables')}</strong></div>
          <CodeEditor value={graphqlVariables} language="json" height="100%" onChange={setGraphqlVariables} />
        </div>

        <div className="graphql-side-column">
          <div className="tabs graphql-tabs">
            <button className={sideTab === 'headers' ? 'active' : ''} onClick={() => setSideTab('headers')}>{t('Headers')}</button>
            <button className={sideTab === 'auth' ? 'active' : ''} onClick={() => setSideTab('auth')}>{t('Authorization')}</button>
          </div>
          <div className="graphql-side-content">
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
        </div>

        <div className="graphql-response">
          <div className="graphql-response-heading">
            <strong>{t('Response')}</strong>
            {response && <span>{response.status} {response.statusText} · {response.elapsedMs} ms · {response.sizeBytes} B</span>}
          </div>
          {error ? (
            <pre className="graphql-error">{error}</pre>
          ) : response ? (
            <CodeEditor
              value={responseText}
              language={response.bodyEncoding === 'base64' ? 'plaintext' : 'json'}
              height="100%"
              readOnly
            />
          ) : (
            <div className="page-empty">
              <strong>{t('No GraphQL response yet')}</strong>
              <span>{t('Write a query and send it to inspect the response.')}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
