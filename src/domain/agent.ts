/** Connection to an apiforge-agent that executes requests for the browser build. */
export type AgentConnection = {
  enabled: boolean;
  /** Base URL such as http://127.0.0.1:47811, without a trailing slash. */
  url: string;
  token: string;
};

export type AgentMode = 'local' | 'relay';

export type AgentInfo = {
  name: string;
  version: string;
  mode: AgentMode;
  capabilities: {
    localFiles: boolean;
    proxies: boolean;
    privateNetworks: boolean;
    cookieJar: boolean;
    maxResponseBytes: number | null;
  };
};

export const DEFAULT_AGENT_URL = 'http://127.0.0.1:47811';
