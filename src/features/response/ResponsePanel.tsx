import { formatBytes, headerValue, responseLanguage, prettyBody, countMatches } from './format.ts';
import { translate as t, useLocale } from '../../i18n/index.ts';
import { AlertCircle, Braces, Code2, Eye, FileJson2, ListTree, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore.ts';
import { CodeEditor } from '../../shared/components/CodeEditor.tsx';

type Tab = 'pretty' | 'raw' | 'preview' | 'headers';

export function ResponsePanel() {
  useLocale();
  const [tab, setTab] = useState<Tab>('pretty');
  const [searchQuery, setSearchQuery] = useState('');
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const runtime = useAppStore((state) => state.runtimeByRequest[activeRequestId]);
  const response = runtime?.response ?? null;
  const error = runtime?.error ?? null;
  const sending = runtime?.sending ?? false;
  const contentType = response ? headerValue(response.headers, 'content-type').toLowerCase() : '';
  const isBinary = response?.bodyEncoding === 'base64';
  const language = response && !isBinary ? responseLanguage(contentType, response.body) : 'plaintext';
  const pretty = useMemo(() => (response && !isBinary ? prettyBody(response.body, language) : ''), [response, language, isBinary]);
  const isHtml = Boolean(response && !isBinary && contentType.includes('text/html'));
  const isImage = Boolean(response && isBinary && contentType.startsWith('image/'));
  const isPdf = Boolean(response && isBinary && contentType.includes('application/pdf'));
  const canPreview = isHtml || isImage || isPdf;
  const cancelled = Boolean(error && (error.toLowerCase().includes('cancel') || error.includes('已取消')));
  const searchableText = response && !isBinary ? (tab === 'pretty' ? pretty : response.body) : '';
  const matchCount = useMemo(() => countMatches(searchableText, searchQuery), [searchableText, searchQuery]);

  return (
    <section className="response-panel">
      <div className="response-heading">
        <strong>{t("Response")}</strong>
        {response && (
          <div className="response-meta">
            <span className={response.status < 400 ? 'status-ok' : 'status-bad'}>{response.status} {response.statusText}</span>
            <span>{response.elapsedMs} ms</span>
            <span>{formatBytes(response.sizeBytes)}</span>
          </div>
        )}
      </div>

      {error ? (
        <div className={`response-error ${cancelled ? 'cancelled' : ''}`}>
          <AlertCircle size={18} />
          <div>
            <strong>{cancelled ? t("Request cancelled") : t("Request failed")}</strong>
            <p>{error}</p>
            {!cancelled && <small>{t("Tip: browser preview is subject to CORS. Run with Tauri for unrestricted desktop HTTP requests.")}</small>}
          </div>
        </div>
      ) : !response ? (
        <div className="response-empty">
          <div className="empty-icon"><Braces size={22} /></div>
          <strong>{sending ? t("Sending request…") : t("Send a request to see the response")}</strong>
          <span>{sending ? t("Use Cancel to abort the in-flight request.") : t("Use Ctrl/⌘ + Enter from the URL field for a shortcut.")}</span>
        </div>
      ) : (
        <>
          <div className="tabs response-tabs">
            <button className={tab === 'pretty' ? 'active' : ''} disabled={isBinary} onClick={() => setTab('pretty')}><FileJson2 size={14} /> {t("Pretty")}</button>
            <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}><Code2 size={14} /> {t("Raw")}</button>
            <button className={tab === 'preview' ? 'active' : ''} disabled={!canPreview} title={canPreview ? t("Preview response") : t("Preview supports HTML, images, and PDF")} onClick={() => setTab('preview')}><Eye size={14} /> {t("Preview")}</button>
            <button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}><ListTree size={14} /> {t("Headers")} <span>{Object.keys(response.headers).length}</span></button>
            {!isBinary && (tab === 'pretty' || tab === 'raw') && (
              <label className="response-search">
                <Search size={13} />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("Search response")} />
                {searchQuery && <span>{matchCount}</span>}
              </label>
            )}
          </div>
          {tab === 'headers' ? (
            <div className="response-headers">
              {Object.entries(response.headers).map(([key, value]) => (
                <div key={key}><span>{key}</span><code>{value}</code></div>
              ))}
            </div>
          ) : tab === 'preview' && canPreview ? (
            <div className="response-preview-shell">
              {isHtml && <iframe title={t("Response preview")} sandbox="" referrerPolicy="no-referrer" srcDoc={response.body} />}
              {isImage && <div className="binary-image-preview"><img alt={t("API response preview")} src={`data:${contentType || 'application/octet-stream'};base64,${response.body}`} /></div>}
              {isPdf && <iframe title={t("PDF response preview")} src={`data:application/pdf;base64,${response.body}`} />}
            </div>
          ) : (
            <div className="response-editor-wrap">
              <CodeEditor
                value={isBinary ? response.body : (tab === 'pretty' ? pretty : response.body)}
                language={isBinary ? 'plaintext' : (tab === 'pretty' ? language : 'plaintext')}
                readOnly
                height="100%"
                searchQuery={isBinary ? '' : searchQuery}
              />
              {isBinary && <div className="binary-encoding-badge">{t("Binary response shown as Base64")}</div>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
