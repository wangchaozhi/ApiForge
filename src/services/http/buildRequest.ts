import type { ApiRequest } from '../../domain/request.ts';
import type { EngineBody, EngineRequest } from '../../domain/engine.ts';
import type { NetworkSettings } from '../../domain/network.ts';

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
      url.searchParams.append(interpolate(item.key, variables), interpolate(item.value, variables));
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
