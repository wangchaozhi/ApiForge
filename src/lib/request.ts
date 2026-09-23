import { translate as t } from '../i18n';
import type { ApiRequest, ApiResponse, AuthConfig, CookieInfo, EngineBody, EngineField, EngineRequest, NetworkSettings } from '../types/api';

const browserControllers = new Map<string, AbortController>();

function isTextualContentType(contentType: string) {
  const value = contentType.toLowerCase();
  return !value.trim()
    || value.startsWith('text/')
    || value.includes('json')
    || value.includes('xml')
    || value.includes('javascript')
    || value.includes('x-www-form-urlencoded')
    || value.includes('svg');
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export function interpolate(input: string, variables: Record<string, string>) {
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => variables[key.trim()] ?? '');
}

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildUrl(request: ApiRequest, variables: Record<string, string>) {
  const rawUrl = interpolate(request.url, variables);
  const url = new URL(rawUrl);

  request.params
    .filter((item) => item.enabled && item.key.trim())
    .forEach((item) => {
      url.searchParams.set(interpolate(item.key, variables), interpolate(item.value, variables));
    });

  if (request.auth.type === 'apiKey' && request.auth.addTo === 'query' && request.auth.key.trim()) {
    url.searchParams.set(interpolate(request.auth.key, variables), interpolate(request.auth.value, variables));
  }

  return url.toString();
}

function buildBody(request: ApiRequest, variables: Record<string, string>): EngineBody {
  if (request.bodyType === 'none') return { type: 'none' };
  if (request.bodyType === 'json' || request.bodyType === 'raw') {
    return { type: 'text', content: interpolate(request.body, variables) };
  }
  if (request.bodyType === 'form-urlencoded') {
    return {
      type: 'urlencoded',
      fields: request.formFields
        .filter((item) => item.enabled && item.key.trim())
        .map((item) => ({
          key: interpolate(item.key, variables),
          value: interpolate(item.value, variables),
        })),
    };
  }
  return {
    type: 'multipart',
    fields: request.multipartFields
      .filter((item) => item.enabled && item.key.trim() && (item.kind === 'text' || item.value.trim()))
      .map((item) => ({
        key: interpolate(item.key, variables),
        value: item.kind === 'file' ? item.value : interpolate(item.value, variables),
        kind: item.kind,
        fileName: item.fileName,
      })),
  };
}

export function toEngineRequest(
  request: ApiRequest,
  variables: Record<string, string>,
  network: NetworkSettings,
): EngineRequest {
  const headers = Object.fromEntries(
    request.headers
      .filter((item) => item.enabled && item.key.trim())
      .map((item) => [interpolate(item.key, variables), interpolate(item.value, variables)]),
  );

  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
  if (request.bodyType === 'json' && !hasContentType) headers['Content-Type'] = 'application/json';
  if (request.bodyType === 'form-urlencoded' && !hasContentType) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (request.bodyType === 'form-data') {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type' && headers[key].toLowerCase().includes('multipart/form-data')) {
        delete headers[key];
      }
    }
  }

  if (request.auth.type === 'bearer' && request.auth.token) {
    headers.Authorization = `Bearer ${interpolate(request.auth.token, variables)}`;
  } else if (request.auth.type === 'oauth2' && request.auth.accessToken) {
    headers.Authorization = `Bearer ${interpolate(request.auth.accessToken, variables)}`;
  } else if (request.auth.type === 'basic') {
    const username = interpolate(request.auth.username, variables);
    const password = interpolate(request.auth.password, variables);
    headers.Authorization = `Basic ${utf8Base64(`${username}:${password}`)}`;
  } else if (request.auth.type === 'apiKey' && request.auth.addTo === 'header' && request.auth.key.trim()) {
    headers[interpolate(request.auth.key, variables)] = interpolate(request.auth.value, variables);
  }

  return {
    method: request.method,
    url: buildUrl(request, variables),
    headers,
    body: buildBody(request, variables),
    network,
    digestAuth: request.auth.type === 'digest'
      ? {
          username: interpolate(request.auth.username, variables),
          password: interpolate(request.auth.password, variables),
        }
      : undefined,
  };
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function browserBody(body: EngineBody): BodyInit | undefined {
  if (body.type === 'none') return undefined;
  if (body.type === 'text') return body.content;
  if (body.type === 'urlencoded') {
    const params = new URLSearchParams();
    for (const field of body.fields) params.append(field.key, field.value);
    return params;
  }

  const form = new FormData();
  for (const field of body.fields) {
    if (field.kind === 'file') throw new Error(t("Multipart file uploads require the Tauri desktop runtime."));
    form.append(field.key, field.value);
  }
  return form;
}

export async function sendApiRequest(request: EngineRequest, operationId: string): Promise<ApiResponse> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ApiResponse>('send_request', { operationId, request });
  }

  if (request.digestAuth) {
    throw new Error(t('Digest Auth requires the Tauri desktop runtime.'));
  }

  const started = performance.now();
  const controller = new AbortController();
  browserControllers.set(operationId, controller);
  const timeout = window.setTimeout(() => controller.abort(), Math.max(1, request.network.timeoutMs));
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method.toUpperCase()) ? undefined : browserBody(request.body),
      redirect: request.network.followRedirects ? 'follow' : 'manual',
      credentials: request.network.cookiesEnabled ? 'include' : 'omit',
      signal: controller.signal,
    });
    const headers = Object.fromEntries(response.headers.entries());
    const contentType = response.headers.get('content-type') ?? '';
    let body: string;
    let bodyEncoding: 'utf8' | 'base64' = 'utf8';
    let sizeBytes = 0;
    if (isTextualContentType(contentType)) {
      body = await response.text();
      sizeBytes = new TextEncoder().encode(body).byteLength;
    } else {
      const bytes = await response.arrayBuffer();
      body = arrayBufferToBase64(bytes);
      bodyEncoding = 'base64';
      sizeBytes = bytes.byteLength;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      bodyEncoding,
      elapsedMs: Math.round(performance.now() - started),
      sizeBytes,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(t("Request cancelled."));
    throw error;
  } finally {
    browserControllers.delete(operationId);
    window.clearTimeout(timeout);
  }
}

export async function refreshOAuthAccessToken(
  oauth: Extract<AuthConfig, { type: 'oauth2' }>,
  variables: Record<string, string>,
  network: NetworkSettings,
): Promise<Extract<AuthConfig, { type: 'oauth2' }>> {
  if (!oauth.refreshToken || !oauth.tokenUrl) return oauth;
  if (oauth.accessToken && (!oauth.expiresAt || oauth.expiresAt > Date.now() + 30_000)) return oauth;

  const fields: EngineField[] = [
    { key: 'grant_type', value: 'refresh_token' },
    { key: 'refresh_token', value: interpolate(oauth.refreshToken, variables) },
    { key: 'client_id', value: interpolate(oauth.clientId, variables) },
  ];
  const clientSecret = interpolate(oauth.clientSecret, variables);
  if (clientSecret) fields.push({ key: 'client_secret', value: clientSecret });
  const response = await sendApiRequest({
    method: 'POST',
    url: interpolate(oauth.tokenUrl, variables),
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: { type: 'urlencoded', fields },
    network,
  }, `oauth-refresh-${crypto.randomUUID()}`);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    throw new Error(t('OAuth token endpoint did not return JSON.'));
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof payload.error_description === 'string'
      ? payload.error_description
      : typeof payload.error === 'string' ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!accessToken) throw new Error(t('OAuth token response did not include access_token.'));
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : Number(payload.expires_in);
  return {
    ...oauth,
    accessToken,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : oauth.refreshToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
  };
}

export async function cancelApiRequest(operationId: string) {
  const browserController = browserControllers.get(operationId);
  if (browserController) {
    browserController.abort();
    return;
  }
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cancel_request', { operationId });
}

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
