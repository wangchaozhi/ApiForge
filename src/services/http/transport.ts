import { isTauriRuntime } from '../../platform/runtime.ts';
import { activeAgentConnection } from '../../platform/agentConnection.ts';
import { sendBrowserRequest, cancelBrowserRequest } from './browser.ts';
import { sendAgentRequest, cancelAgentRequest } from './agent.ts';
import type { ApiResponse } from '../../domain/response.ts';
import type { EngineRequest } from '../../domain/engine.ts';

export type RequestEngine = 'desktop' | 'agent' | 'browser';

/** Desktop builds use the native engine; the web build uses a configured agent, else fetch. */
export function currentRequestEngine(): RequestEngine {
  if (isTauriRuntime()) return 'desktop';
  return activeAgentConnection() ? 'agent' : 'browser';
}

export async function sendApiRequest(request: EngineRequest, operationId: string): Promise<ApiResponse> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ApiResponse>('send_request', { operationId, request });
  }
  const agent = activeAgentConnection();
  if (agent) return sendAgentRequest(agent, request, operationId);
  return sendBrowserRequest(request, operationId);
}

export async function cancelApiRequest(operationId: string) {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('cancel_request', { operationId });
    return;
  }
  // The engine may have changed while the request was in flight; each adapter ignores unknown IDs.
  cancelBrowserRequest(operationId);
  await cancelAgentRequest(operationId);
}
