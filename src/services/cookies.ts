import { isTauriRuntime } from '../platform/runtime.ts';
import type { CookieInfo } from '../domain/cookies.ts';

export async function clearCookieJar() {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('clear_cookie_jar');
}

export async function listCookies(): Promise<CookieInfo[]> {
  if (!isTauriRuntime()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CookieInfo[]>('list_cookies');
}

export async function removeCookie(domain: string, path: string, name: string) {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('remove_cookie', { domain, path, name });
}
