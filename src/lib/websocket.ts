import type { EngineRequest } from '../types/api';
import { cancelApiRequest, isTauriRuntime } from './request';

export type WebSocketNativeEvent =
  | { type: 'opened'; operationId: string }
  | { type: 'message'; operationId: string; data: string; binary: boolean }
  | { type: 'ping' | 'pong'; operationId: string; data: string }
  | { type: 'closed'; operationId: string; code?: number; reason: string };

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

export async function sendWebSocketMessage(operationId: string, data: string, binary = false) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('send_websocket_message', { operationId, data, binary });
}

export async function disconnectWebSocket(operationId: string) {
  await cancelApiRequest(operationId);
}
