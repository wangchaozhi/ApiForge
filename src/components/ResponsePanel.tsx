import { AlertCircle, Braces, Code2, Eye, FileJson2, ListTree, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { CodeEditor, type EditorLanguage } from './CodeEditor';

type Tab = 'pretty' | 'raw' | 'preview' | 'headers';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function headerValue(headers: Record<string, string>, key: string) {
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return match?.[1] ?? '';
}

function responseLanguage(contentType: string, body: string): EditorLanguage {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('html')) return 'html';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('javascript')) return 'javascript';
  if (contentType.includes('css')) return 'css';
  try {
    JSON.parse(body);
    return 'json';
  } catch {
    return 'plaintext';
  }
}

function prettyBody(body: string, language: EditorLanguage) {
  if (language !== 'json') return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function countMatches(haystack: string, needle: string) {
  if (!needle) return 0;
  const source = haystack.toLowerCase();
  const query = needle.toLowerCase();
  let count = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const index = source.indexOf(query, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + Math.max(1, query.length);
  }
  return count;
}

export function ResponsePanel() {
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
  const cancelled = Boolean(error && error.toLowerCase().includes('cancel'));
  const searchableText = response && !isBinary ? (tab === 'pretty' ? pretty : response.body) : '';
  const matchCount = useMemo(() => countMatches(searchableText, searchQuery), [searchableText, searchQuery]);

  return (
    <section className="response-panel">
      <div className="response-heading">
        <strong>Response</strong>
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
            <strong>{cancelled ? 'Request cancelled' : 'Request failed'}</strong>
            <p>{error}</p>
            {!cancelled && <small>Tip: browser preview is subject to CORS. Run with Tauri for unrestricted desktop HTTP requests.</small>}
          </div>
        </div>
      ) : !response ? (
        <div className="response-empty">
          <div className="empty-icon"><Braces size={22} /></div>
          <strong>{sending ? 'Sending request…' : 'Send a request to see the response'}</strong>
          <span>{sending ? 'Use Cancel to abort the in-flight request.' : 'Use Ctrl/⌘ + Enter from the URL field for a shortcut.'}</span>
        </div>
      ) : (
        <>
          <div className="tabs response-tabs">
            <button className={tab === 'pretty' ? 'active' : ''} disabled={isBinary} onClick={() => setTab('pretty')}><FileJson2 size={14} /> Pretty</button>
            <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}><Code2 size={14} /> Raw</button>
            <button className={tab === 'preview' ? 'active' : ''} disabled={!canPreview} title={canPreview ? 'Preview response' : 'Preview supports HTML, images, and PDF'} onClick={() => setTab('preview')}><Eye size={14} /> Preview</button>
            <button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}><ListTree size={14} /> Headers <span>{Object.keys(response.headers).length}</span></button>
            {!isBinary && (tab === 'pretty' || tab === 'raw') && (
              <label className="response-search">
                <Search size={13} />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search response" />
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
              {isHtml && <iframe title="Response preview" sandbox="" referrerPolicy="no-referrer" srcDoc={response.body} />}
              {isImage && <div className="binary-image-preview"><img alt="API response preview" src={`data:${contentType || 'application/octet-stream'};base64,${response.body}`} /></div>}
              {isPdf && <iframe title="PDF response preview" src={`data:application/pdf;base64,${response.body}`} />}
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
              {isBinary && <div className="binary-encoding-badge">Binary response shown as Base64</div>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
