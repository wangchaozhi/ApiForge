import { translate as t, useLocale } from '../../i18n/index.ts';
import { PlugZap, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_AGENT_URL, type AgentInfo } from '../../domain/agent.ts';
import { normalizeAgentUrl, useAgentConnectionStore } from '../../platform/agentConnection.ts';
import { fetchAgentInfo, probeAgent } from '../../services/http/agent.ts';

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; info: AgentInfo }
  | { status: 'error'; message: string };

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Browser build only: route requests through apiforge-agent instead of window.fetch. */
export function AgentSettingsCard() {
  useLocale();
  const connection = useAgentConnectionStore((state) => state.connection);
  const updateConnection = useAgentConnectionStore((state) => state.updateConnection);
  const [urlDraft, setUrlDraft] = useState(connection.url);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  // When the web app is served by an agent (--static-dir), suggest that same origin.
  useEffect(() => {
    if (connection.token || connection.url !== DEFAULT_AGENT_URL || typeof window === 'undefined') return;
    const origin = window.location.origin;
    if (!/^https?:/.test(origin) || origin === DEFAULT_AGENT_URL) return;
    const controller = new AbortController();
    void probeAgent(origin, controller.signal).then((found) => {
      if (!found || controller.signal.aborted) return;
      updateConnection({ url: origin });
      setUrlDraft(origin);
    });
    return () => controller.abort();
  }, [connection.token, connection.url, updateConnection]);

  const testConnection = async () => {
    const url = normalizeAgentUrl(urlDraft);
    updateConnection({ url });
    setTest({ status: 'testing' });
    try {
      const info = await fetchAgentInfo({ ...connection, url });
      setTest({ status: 'ok', info });
    } catch (error) {
      setTest({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const active = connection.enabled && Boolean(connection.url && connection.token);
  const info = test.status === 'ok' ? test.info : null;

  return (
    <div className="settings-card">
      <div className="settings-card-title">
        <Server size={16} />
        <div><strong>{t('Request agent')}</strong><span>{t('Send web requests without browser CORS limits')}</span></div>
      </div>
      <label className="settings-toggle">
        <input type="checkbox" checked={connection.enabled} onChange={(event) => updateConnection({ enabled: event.target.checked })} />
        <div>
          <strong>{t('Send requests through apiforge-agent')}</strong>
          <span>{t('Run apiforge-agent on your computer, then enter the URL and token it prints. A local agent can reach localhost and intranet APIs.')}</span>
        </div>
      </label>
      <label className="settings-field">
        <span>{t('Agent URL')}</span>
        <input
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          onBlur={() => updateConnection({ url: urlDraft })}
          placeholder={DEFAULT_AGENT_URL}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="settings-field">
        <span>{t('Agent token')}</span>
        <input
          type="password"
          value={connection.token}
          onChange={(event) => updateConnection({ token: event.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="settings-inline-action agent-status">
        <button className="secondary-button compact" disabled={test.status === 'testing' || !connection.token} onClick={() => void testConnection()}>
          <PlugZap size={13} />{test.status === 'testing' ? t('Testing…') : t('Test connection')}
        </button>
        {info && (
          <span className="agent-status-ok">
            {t('Connected to apiforge-agent {version} ({mode} mode).', { version: info.version, mode: info.mode })}
            {info.mode === 'relay' && ` ${t('Relay mode reaches public addresses only; responses are limited to {size}.', { size: formatBytes(info.capabilities.maxResponseBytes ?? 0) })}`}
          </span>
        )}
        {test.status === 'error' && <span className="agent-status-error">{test.message}</span>}
      </div>
      <p className="settings-description">
        {active ? t('Requests are sent by the request agent.') : t('Requests are sent by the browser and are subject to CORS.')}
        {' '}{t('The token is stored only in this browser.')}
      </p>
    </div>
  );
}
