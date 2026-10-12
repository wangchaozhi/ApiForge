import type { EngineRequest } from '../domain/engine.ts';
import type { WebSocketSendKind } from './protocols.ts';
import { cancelApiRequest } from './http/transport.ts';
import { isTauriRuntime } from '../platform/runtime.ts';

export { validateOutgoing, type WebSocketSendKind } from './protocols.ts';

export type WebSocketNativeEvent =
  | { type: 'opened'; operationId: string; status: number; headers: Record<string, string>; protocol?: string | null }
  | { type: 'message'; operationId: string; data: string; binary: boolean }
  | { type: 'sent'; operationId: string; data: string; kind: WebSocketSendKind }
  | { type: 'ping' | 'pong'; operationId: string; data: string }
  | { type: 'closed'; operationId: string; code?: number | null; reason: string };

export type WebSocketHandlers = {
  onEvent: (event: WebSocketNativeEvent) => void;
};

export async function connectWebSocket(
  request: EngineRequest,
  operationId: string,
  handlers: WebSocketHandlers,
) {
  if (!isTauriRuntime()) throw new Error('Native WebSocket requires the Tauri desktop runtime.');
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  const unlisten = await listen<WebSocketNativeEvent>('apiforge://websocket', ({ payload }) => {
    if (payload.operationId === operationId) handlers.onEvent(payload);
  });
  try {
    await invoke('start_websocket', { operationId, request });
  } finally {
    unlisten();
  }
}

export async function sendWebSocketMessage(operationId: string, data: string, kind: WebSocketSendKind = 'text') {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('send_websocket_message', { operationId, data, kind });
}

export async function disconnectWebSocket(operationId: string) {
  await cancelApiRequest(operationId);
}
