import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_AGENT_URL, type AgentConnection } from '../domain/agent.ts';

/**
 * The agent connection is a per-browser setting. It is stored under its own key, outside the
 * workspace, so it never appears in workspace exports or reaches another machine.
 */
export const AGENT_CONNECTION_STORAGE_KEY = 'apiforge-agent-v1';

type AgentConnectionState = {
  connection: AgentConnection;
  updateConnection: (patch: Partial<AgentConnection>) => void;
};

export function normalizeAgentUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

export function normalizeAgentConnection(value: unknown): AgentConnection {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof AgentConnection, unknown>>;
  return {
    enabled: source.enabled === true,
    url: typeof source.url === 'string' ? normalizeAgentUrl(source.url) : DEFAULT_AGENT_URL,
    token: typeof source.token === 'string' ? source.token.trim() : '',
  };
}

export const useAgentConnectionStore = create<AgentConnectionState>()(persist((set) => ({
  connection: normalizeAgentConnection({ url: DEFAULT_AGENT_URL }),
  updateConnection: (patch) => set((state) => ({
    connection: normalizeAgentConnection({ ...state.connection, ...patch }),
  })),
}), {
  name: AGENT_CONNECTION_STORAGE_KEY,
  partialize: (state) => ({ connection: state.connection }),
  merge: (persisted, current) => ({
    ...current,
    connection: normalizeAgentConnection((persisted as { connection?: unknown } | null)?.connection ?? current.connection),
  }),
}));

/** The connection requests should use, or null when the browser should send them itself. */
export function activeAgentConnection(): AgentConnection | null {
  const { connection } = useAgentConnectionStore.getState();
  return connection.enabled && connection.url && connection.token ? connection : null;
}
