import { Braces, Send, Square, WandSparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t, useLocale } from '../../i18n/index.ts';
import { createId } from '../../lib/id.ts';
import { cancelApiRequest, sendApiRequest } from '../../services/http/transport.ts';
import { toEngineRequest } from '../../services/http/buildRequest.ts';
import { formatGraphql } from '../../services/graphql/format.ts';
import { listGraphqlOperations, operationNameProblem } from '../../services/graphql/lexer.ts';
import { buildIntrospectionQuery, INTROSPECTION_DEPTHS, parseIntrospection, type GraphqlSchema } from '../../services/graphql/schema.ts';
import { getActiveEnvironmentValues, useAppStore } from '../../store/appStore.ts';
import type { ApiRequest, KeyValue } from '../../domain/request.ts';
import type { ApiResponse } from '../../domain/response.ts';
import { AuthEditor } from '../requests/AuthEditor.tsx';
import { CodeEditor } from '../../shared/components/CodeEditor.tsx';
import { KeyValueEditor } from '../../shared/components/KeyValueEditor.tsx';
import { useGraphqlCompletion } from './completionProvider.ts';
import { SchemaBrowser } from './SchemaBrowser.tsx';

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
  const environmentProfiles = useAppStore((state) => state.environmentProfiles);
  const activeEnvironmentId = useAppStore((state) => state.activeEnvironmentId);
  const variables = useMemo(
    () => getActiveEnvironmentValues({ environmentProfiles, activeEnvironmentId }),
    [environmentProfiles, activeEnvironmentId],
  );
  const networkSettings = useAppStore((state) => state.networkSettings);

  const [request, setRequest] = useState<ApiRequest>(() => starterRequest());
  const [query, setQuery] = useState('query Example {\n  __typename\n}');
  const [graphqlVariables, setGraphqlVariables] = useState('{}');
  const [operationName, setOperationName] = useState('');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'headers' | 'auth' | 'schema'>('headers');
  const [schema, setSchema] = useState<GraphqlSchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  useGraphqlCompletion(schema);
  const operationNames = useMemo(
    () => listGraphqlOperations(query).flatMap((operation) => operation.name ? [operation.name] : []),
    [query],
  );

  const sending = operationId !== null;
  const responseText = useMemo(() => prettyBody(response), [response]);
  const updateRequest = (updater: (current: ApiRequest) => ApiRequest) => {
    setRequest((current) => updater(current));
  };

  const formatQuery = () => setQuery(formatGraphql(query));

  const formatVariables = () => {
    try {
      setGraphqlVariables(JSON.stringify(JSON.parse(graphqlVariables || '{}'), null, 2));
    } catch {
      setError(t('GraphQL variables must be valid JSON.'));
    }
  };

  const send = async () => {
    const operationProblem = operationNameProblem(query, operationName);
    if (operationProblem) {
      setError(t(operationProblem));
      return;
    }
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

  const loadSchema = async () => {
    const nextOperationId = createId('graphql-schema');
    setOperationId(nextOperationId);
    setLoadingSchema(true);
    setError(null);
    try {
      let lastError: unknown;
      let loaded: GraphqlSchema | null = null;
      for (const depth of INTROSPECTION_DEPTHS) {
        const engineRequest = toEngineRequest({
          ...request,
          method: 'POST',
          bodyType: 'json',
          body: JSON.stringify({ query: buildIntrospectionQuery(depth), variables: {} }),
        }, variables, networkSettings);
        const nextResponse = await sendApiRequest(engineRequest, nextOperationId);
        try {
          let payload: unknown;
          try {
            payload = JSON.parse(nextResponse.body);
          } catch {
            throw new Error(t('Schema request returned HTTP {status} without a JSON body.', { status: nextResponse.status }));
          }
          loaded = parseIntrospection(payload);
          break;
        } catch (cause) {
          // Retry with shallower type references for servers that limit query depth.
          lastError = cause;
        }
      }
      if (!loaded) throw lastError;
      setSchema(loaded);
      setSideTab('schema');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingSchema(false);
      setOperationId(null);
    }
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
            <div className="graphql-heading-actions">
              <input
                value={operationName}
                onChange={(event) => setOperationName(event.target.value)}
                placeholder={operationNames.length > 1 ? t('Operation name (required)') : t('Operation name (optional)')}
                list="graphql-operation-names"
                spellCheck={false}
              />
              <datalist id="graphql-operation-names">{operationNames.map((name) => <option key={name} value={name} />)}</datalist>
              <button className="secondary-button compact" onClick={formatQuery} title={t('Format query')}><WandSparkles size={13} />{t('Format')}</button>
            </div>
          </div>
          <CodeEditor value={query} language="graphql" height="100%" onChange={setQuery} />
        </div>

        <div className="graphql-editor-column">
          <div className="graphql-section-heading"><strong>{t('Variables')}</strong><button className="secondary-button compact" onClick={formatVariables}><Braces size={13} />{t('Format')}</button></div>
          <CodeEditor value={graphqlVariables} language="json" height="100%" onChange={setGraphqlVariables} />
        </div>

        <div className="graphql-side-column">
          <div className="tabs graphql-tabs">
            <button className={sideTab === 'headers' ? 'active' : ''} onClick={() => setSideTab('headers')}>{t('Headers')}</button>
            <button className={sideTab === 'auth' ? 'active' : ''} onClick={() => setSideTab('auth')}>{t('Authorization')}</button>
            <button className={sideTab === 'schema' ? 'active' : ''} onClick={() => setSideTab('schema')}>{t('Schema')}</button>
          </div>
          <div className="graphql-side-content">
            {sideTab === 'headers' && (
              <KeyValueEditor
                rows={request.headers}
                onChange={(headers) => updateRequest((current) => ({ ...current, headers }))}
              />
            )}
            {sideTab === 'auth' && (
              <AuthEditor
                request={request}
                onChange={(auth) => updateRequest((current) => ({ ...current, auth }))}
              />
            )}
            {sideTab === 'schema' && (
              <SchemaBrowser schema={schema} loading={loadingSchema} onLoad={() => void loadSchema()} />
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
