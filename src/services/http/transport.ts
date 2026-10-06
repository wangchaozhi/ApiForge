import { isTauriRuntime } from '../../platform/runtime.ts';
import { sendBrowserRequest, cancelBrowserRequest } from './browser.ts';
import type { ApiResponse } from '../../domain/response.ts';
import type { EngineRequest } from '../../domain/engine.ts';

export async function sendApiRequest(request: EngineRequest, operationId: string): Promise<ApiResponse> {
  if (!isTauriRuntime()) return sendBrowserRequest(request, operationId);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ApiResponse>('send_request', { operationId, request });
}

export async function cancelApiRequest(operationId: string) {
  if (!isTauriRuntime()) return cancelBrowserRequest(operationId);
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cancel_request', { operationId });
}
