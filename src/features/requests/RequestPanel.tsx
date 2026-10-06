import { CodeEditor } from '../../shared/components/CodeEditor.tsx';
import { RequestBodyEditor } from './RequestBodyEditor.tsx';
import { useRequestExecution } from './useRequestExecution.ts';
import { translate as t, useLocale } from '../../i18n/index.ts';
import { useMemo, useState } from 'react';
import { Download, Send, Square, Upload } from 'lucide-react';
import { AuthEditor } from './AuthEditor.tsx';
import { CurlDialog } from './CurlDialog.tsx';
import { KeyValueEditor } from '../../shared/components/KeyValueEditor.tsx';
import { curlToRequest } from '../../services/curl/import.ts';
import { requestToCurl } from '../../services/curl/export.ts';
import { getActiveEnvironmentValues, useAppStore } from '../../store/appStore.ts';
import type { HttpMethod } from '../../domain/request.ts';

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
type Tab = 'params' | 'headers' | 'auth' | 'body' | 'scripts';

export function RequestPanel() {
  useLocale();
  const [tab, setTab] = useState<Tab>('params');
  const [curlDialog, setCurlDialog] = useState<'import' | 'export' | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const request = useAppStore((state) => state.requests.find((item) => item.id === activeRequestId));
  const environmentProfiles = useAppStore((state) => state.environmentProfiles);
  const activeEnvironmentId = useAppStore((state) => state.activeEnvironmentId);
  const variables = useMemo(() => getActiveEnvironmentValues({ environmentProfiles, activeEnvironmentId }), [environmentProfiles, activeEnvironmentId]);
  const networkSettings = useAppStore((state) => state.networkSettings);
  const update = useAppStore((state) => state.updateActiveRequest);
  const importRequest = useAppStore((state) => state.importRequest);
  const runtime = useAppStore((state) => state.runtimeByRequest[activeRequestId]);

  const counts = useMemo(() => ({
    params: request?.params.filter((item) => item.enabled && item.key).length ?? 0,
    headers: request?.headers.filter((item) => item.enabled && item.key).length ?? 0,
  }), [request]);

  const { send, cancel } = useRequestExecution(request, variables, networkSettings, runtime?.operationId ?? null);

  if (!request) return <main className="empty-state">{t("No request selected.")}</main>;

  const sending = runtime?.sending ?? false;

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
        <button className={tab === 'scripts' ? 'active' : ''} onClick={() => setTab('scripts')}>{t('Scripts')}</button>
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
          <RequestBodyEditor request={request} update={update} />
        )}
        {tab === 'scripts' && (
          <div className="script-editors">
            <section className="script-editor-card">
              <div className="script-editor-heading">
                <strong>{t('Pre-request Script')}</strong>
                <span>{t('Scripts execute when this request runs in Collection Runner.')}</span>
              </div>
              <CodeEditor
                value={request.preRequestScript ?? ''}
                language="javascript"
                onChange={(preRequestScript) => update((current) => ({ ...current, preRequestScript }))}
              />
            </section>
            <section className="script-editor-card">
              <div className="script-editor-heading">
                <strong>{t('Tests')}</strong>
                <span>{t('Scripts execute when this request runs in Collection Runner.')}</span>
              </div>
              <CodeEditor
                value={request.testScript ?? ''}
                language="javascript"
                onChange={(testScript) => update((current) => ({ ...current, testScript }))}
              />
            </section>
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
