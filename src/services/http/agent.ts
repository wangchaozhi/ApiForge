import { translate as t } from '../../i18n/index.ts';
import type { AgentConnection, AgentInfo } from '../../domain/agent.ts';
import type { ApiResponse } from '../../domain/response.ts';
import type { EngineRequest } from '../../domain/engine.ts';

const agentControllers = new Map<string, { connection: AgentConnection; controller: AbortController }>();

type AgentErrorBody = { error?: unknown; kind?: unknown };

export class AgentRequestError extends Error {
  readonly kind: string;
  readonly status: number;

  constructor(message: string, kind: string, status: number) {
    super(message);
    this.name = 'AgentRequestError';
    this.kind = kind;
    this.status = status;
  }
}

async function agentFetch(connection: AgentConnection, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${connection.token}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${connection.url}${path}`, { ...init, headers, credentials: 'omit', cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AgentRequestError(t('Cannot reach the request agent at {url}. Make sure apiforge-agent is running.', { url: connection.url }), 'unreachable', 0);
  }
  if (response.ok) return response;

  let body: AgentErrorBody = {};
  try {
    body = await response.json() as AgentErrorBody;
  } catch {
    // Non-JSON error page (for example a reverse proxy); fall back to the status code.
  }
  const kind = typeof body.kind === 'string' ? body.kind : 'http';
  if (response.status === 401) throw new AgentRequestError(t('The request agent rejected the token.'), 'unauthorized', 401);
  if (kind === 'cancelled') throw new AgentRequestError(t('Request cancelled.'), kind, response.status);
  const detail = typeof body.error === 'string' ? body.error : '';
  if (kind === 'policy') {
    throw new AgentRequestError(t('Blocked by the request agent: {reason}', { reason: detail.replace(/^blocked by execution policy:\s*/, '') }), kind, response.status);
  }
  const message = detail || t('Request agent error ({status}).', { status: response.status });
  throw new AgentRequestError(message, kind, response.status);
}

export async function sendAgentRequest(connection: AgentConnection, request: EngineRequest, operationId: string): Promise<ApiResponse> {
  const controller = new AbortController();
  agentControllers.set(operationId, { connection, controller });
  try {
    const response = await agentFetch(connection, '/v1/http/send', {
      method: 'POST',
      body: JSON.stringify({ operationId, request }),
      signal: controller.signal,
    });
    return await response.json() as ApiResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(t('Request cancelled.'));
    throw error;
  } finally {
    agentControllers.delete(operationId);
  }
}

/** Cancels on the agent first, then drops the browser connection. Unknown IDs are ignored. */
export async function cancelAgentRequest(operationId: string) {
  const entry = agentControllers.get(operationId);
  if (!entry) return;
  try {
    await agentFetch(entry.connection, '/v1/http/cancel', { method: 'POST', body: JSON.stringify({ operationId }) });
  } catch {
    // Aborting the connection below also stops the agent's request.
  } finally {
    entry.controller.abort();
  }
}

export async function fetchAgentInfo(connection: AgentConnection, signal?: AbortSignal): Promise<AgentInfo> {
  const response = await agentFetch(connection, '/v1/info', { signal });
  return await response.json() as AgentInfo;
}

/** True when an apiforge-agent answers at this base URL (no token needed). */
export async function probeAgent(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${url}/v1/health`, { credentials: 'omit', cache: 'no-store', signal });
    if (!response.ok) return false;
    const body = await response.json() as { name?: unknown };
    return body.name === 'apiforge-agent';
  } catch {
    return false;
  }
}
