import { createId } from './id';
import { isTauriRuntime } from './request';
import type { ApiRequest, ApiResponse, EngineRequest, HistoryEntry } from '../types/api';

const BROWSER_HISTORY_KEY = 'apiforge-browser-history-v1';

export function makeHistoryEntry(request: ApiRequest, engineRequest: EngineRequest, response: ApiResponse): HistoryEntry {
  return {
    id: createId('hist'),
    requestId: request.id,
    requestName: request.name,
    method: request.method,
    url: engineRequest.url,
    status: response.status,
    statusText: response.statusText,
    elapsedMs: response.elapsedMs,
    sizeBytes: response.sizeBytes,
    requestJson: JSON.stringify(request),
    responseJson: JSON.stringify(response),
    createdAt: new Date().toISOString(),
  };
}

export async function saveHistory(entry: HistoryEntry) {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_history', { entry });
    return;
  }

  const current = readBrowserHistory();
  localStorage.setItem(BROWSER_HISTORY_KEY, JSON.stringify([entry, ...current].slice(0, 200)));
}

export async function loadHistory(limit = 200): Promise<HistoryEntry[]> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<HistoryEntry[]>('list_history', { limit });
  }
  return readBrowserHistory().slice(0, limit);
}

export async function clearHistory() {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_history');
    return;
  }
  localStorage.removeItem(BROWSER_HISTORY_KEY);
}

function readBrowserHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(BROWSER_HISTORY_KEY) ?? '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}
