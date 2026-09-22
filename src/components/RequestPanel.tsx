import { translate as t, useLocale } from '../i18n';
import { useMemo, useState } from 'react';
import { Download, Send, Square, Upload } from 'lucide-react';
import { AuthEditor } from './AuthEditor';
import { CodeEditor } from './CodeEditor';
import { CurlDialog } from './CurlDialog';
import { KeyValueEditor } from './KeyValueEditor';
import { MultipartEditor } from './MultipartEditor';
import { curlToRequest, requestToCurl } from '../lib/curl';
import { makeHistoryEntry, saveHistory } from '../lib/history';
import { cancelApiRequest, sendApiRequest, toEngineRequest } from '../lib/request';
import { createId } from '../lib/id';
import { useAppStore } from '../store/appStore';
import type { BodyType, HttpMethod } from '../types/api';

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const bodyTypes: BodyType[] = ['none', 'json', 'raw', 'form-urlencoded', 'form-data'];
type Tab = 'params' | 'headers' | 'auth' | 'body';

function bodyLabel(bodyType: BodyType) {
  if (bodyType === 'none') return t("None");
  if (bodyType === 'json') return 'JSON';
  if (bodyType === 'raw') return t("Raw");
  if (bodyType === 'form-urlencoded') return 'x-www-form-urlencoded';
  return 'form-data';
}

export function RequestPanel() {
  useLocale();
  const [tab, setTab] = useState<Tab>('params');
  const [curlDialog, setCurlDialog] = useState<'import' | 'export' | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const request = useAppStore((state) => state.requests.find((item) => item.id === activeRequestId));
  const variables = useAppStore((state) => state.environments);
  const networkSettings = useAppStore((state) => state.networkSettings);
  const update = useAppStore((state) => state.updateActiveRequest);
  const importRequest = useAppStore((state) => state.importRequest);
  const runtime = useAppStore((state) => state.runtimeByRequest[activeRequestId]);
  const startRequest = useAppStore((state) => state.startRequest);
  const completeRequest = useAppStore((state) => state.completeRequest);
  const failRequest = useAppStore((state) => state.failRequest);
  const prependHistory = useAppStore((state) => state.prependHistory);

  const counts = useMemo(() => ({
    params: request?.params.filter((item) => item.enabled && item.key).length ?? 0,
    headers: request?.headers.filter((item) => item.enabled && item.key).length ?? 0,
  }), [request]);

  if (!request) return <main className="empty-state">{t("No request selected.")}</main>;

  const sending = runtime?.sending ?? false;
  const operationId = runtime?.operationId ?? null;

  const send = async () => {
    const requestId = request.id;
    const nextOperationId = createId('op');
    startRequest(requestId, nextOperationId);
    try {
      const engineRequest = toEngineRequest(request, variables, networkSettings);
      const response = await sendApiRequest(engineRequest, nextOperationId);
      completeRequest(requestId, response);
      const historyEntry = makeHistoryEntry(request, engineRequest, response);
      prependHistory(historyEntry);
      void saveHistory(historyEntry).catch(() => undefined);
    } catch (error) {
      failRequest(requestId, error instanceof Error ? error.message : String(error));
    }
  };

  const cancel = async () => {
    if (!operationId) return;
    try {
      await cancelApiRequest(operationId);
    } catch (error) {
      failRequest(request.id, error instanceof Error ? error.message : String(error));
    }
  };

  const handleCurlImport = (value: string) => {
    try {
      setImportError(null);
      importRequest(curlToRequest(value));
      setCurlDialog(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="request-panel">
      <div className="request-title-row">
        <input
          className="request-title"
          value={request.name}
          onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
        />
        <span className="dirty-dot" title={t("Saved locally")} />
        <div className="request-actions">
          <button className="text-button" onClick={() => { setImportError(null); setCurlDialog('import'); }}><Download size={13} /> {t("Import cURL")}</button>
          <button className="text-button" onClick={() => setCurlDialog('export')}><Upload size={13} /> {t("Export cURL")}</button>
        </div>
      </div>

      <div className="url-bar">
        <select
          className={`method-select method-${request.method.toLowerCase()}`}
          value={request.method}
          onChange={(event) => update((current) => ({ ...current, method: event.target.value as HttpMethod }))}
        >
          {methods.map((method) => <option key={method}>{method}</option>)}
        </select>
        <input
          className="url-input"
          value={request.url}
          onChange={(event) => update((current) => ({ ...current, url: event.target.value }))}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void (sending ? cancel() : send());
          }}
          placeholder="https://api.example.com/users"
          spellCheck={false}
        />
        <button className={`send-button ${sending ? 'cancel-button' : ''}`} onClick={() => void (sending ? cancel() : send())}>
          {sending ? <Square size={15} /> : <Send size={17} />}
          {sending ? t("Cancel") : t("Send")}
        </button>
      </div>

      <div className="tabs">
        <button className={tab === 'params' ? 'active' : ''} onClick={() => setTab('params')}>{t("Params")} <span>{counts.params}</span></button>
        <button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>{t("Headers")} <span>{counts.headers}</span></button>
        <button className={tab === 'auth' ? 'active' : ''} onClick={() => setTab('auth')}>{t("Authorization")}</button>
        <button className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>{t("Body")}</button>
      </div>

      <div className="tab-content">
        {tab === 'params' && (
          <KeyValueEditor rows={request.params} onChange={(params) => update((current) => ({ ...current, params }))} />
        )}
        {tab === 'headers' && (
          <KeyValueEditor rows={request.headers} onChange={(headers) => update((current) => ({ ...current, headers }))} />
        )}
        {tab === 'auth' && (
          <AuthEditor request={request} onChange={(auth) => update((current) => ({ ...current, auth }))} />
        )}
        {tab === 'body' && (
          <div className="body-editor">
            <div className="body-type-row">
              {bodyTypes.map((bodyType) => (
                <label key={bodyType}>
                  <input
                    type="radio"
                    name="body-type"
                    value={bodyType}
                    checked={request.bodyType === bodyType}
                    onChange={() => update((current) => ({ ...current, bodyType }))}
                  />
                  {bodyLabel(bodyType)}
                </label>
              ))}
            </div>
            {(request.bodyType === 'json' || request.bodyType === 'raw') && (
              <CodeEditor
                value={request.body}
                language={request.bodyType === 'json' ? 'json' : 'plaintext'}
                onChange={(body) => update((current) => ({ ...current, body }))}
              />
            )}
            {request.bodyType === 'form-urlencoded' && (
              <KeyValueEditor
                rows={request.formFields}
                onChange={(formFields) => update((current) => ({ ...current, formFields }))}
                keyPlaceholder={t("Key")}
                valuePlaceholder={t("Value")}
              />
            )}
            {request.bodyType === 'form-data' && (
              <MultipartEditor
                rows={request.multipartFields}
                onChange={(multipartFields) => update((current) => ({ ...current, multipartFields }))}
              />
            )}
          </div>
        )}
      </div>

      {curlDialog && (
        <>
          <CurlDialog
            mode={curlDialog}
            initialValue={curlDialog === 'export' ? requestToCurl(request, variables, networkSettings) : ''}
            onClose={() => { setCurlDialog(null); setImportError(null); }}
            onImport={handleCurlImport}
          />
          {importError && <div className="dialog-toast error">{importError}</div>}
        </>
      )}
    </section>
  );
}
