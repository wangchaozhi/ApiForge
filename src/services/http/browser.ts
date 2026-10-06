import { translate as t } from '../../i18n/index.ts';
import type { ApiResponse } from '../../domain/response.ts';
import type { EngineBody, EngineRequest } from '../../domain/engine.ts';

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

export async function sendBrowserRequest(request: EngineRequest, operationId: string): Promise<ApiResponse> {
  if (request.digestAuth) throw new Error(t('Digest Auth requires the Tauri desktop runtime.'));

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


export function cancelBrowserRequest(operationId: string) {
  browserControllers.get(operationId)?.abort();
}
