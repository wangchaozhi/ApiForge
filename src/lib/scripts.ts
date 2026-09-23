import type { ApiRequest, ApiResponse, EngineBody, EngineRequest } from '../types/api';
import { isTauriRuntime, interpolate } from './request';

export type ScriptPhase = 'preRequest' | 'test';

export type ScriptTestResult = {
  name: string;
  passed: boolean;
  message: string;
};

export type ScriptResult = {
  environment: Record<string, string | null>;
  headers: Record<string, string | null>;
  tests: ScriptTestResult[];
  logs: string[];
};

function bodySnapshot(body: EngineBody) {
  if (body.type === 'none') return '';
  if (body.type === 'text') return body.content;
  if (body.type === 'urlencoded') {
    return body.fields.map((field) => `${field.key}=${field.value}`).join('&');
  }
  return body.fields.map((field) =>
    field.kind === 'file'
      ? `${field.key}=@${field.value}`
      : `${field.key}=${field.value}`,
  ).join('\n');
}

function rawRequestSnapshot(request: ApiRequest, variables: Record<string, string>) {
  return {
    method: request.method,
    url: interpolate(request.url, variables),
    headers: Object.fromEntries(
      request.headers
        .filter((item) => item.enabled && item.key.trim())
        .map((item) => [interpolate(item.key, variables), interpolate(item.value, variables)]),
    ),
    body: interpolate(request.body, variables),
  };
}

function engineRequestSnapshot(request: EngineRequest) {
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: bodySnapshot(request.body),
  };
}

export async function runRequestScript(
  phase: ScriptPhase,
  script: string,
  environment: Record<string, string>,
  request: ApiRequest | EngineRequest,
  response?: ApiResponse | null,
): Promise<ScriptResult> {
  if (!script.trim()) return { environment: {}, headers: {}, tests: [], logs: [] };
  if (!isTauriRuntime()) {
    throw new Error('Sandboxed request scripts require the Tauri desktop runtime.');
  }

  const requestSnapshot = 'bodyType' in request
    ? rawRequestSnapshot(request, environment)
    : engineRequestSnapshot(request);

  const responseSnapshot = response
    ? {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.bodyEncoding === 'utf8' ? response.body : '',
      }
    : null;

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ScriptResult>('run_script', {
    input: {
      phase,
      script,
      environment,
      request: requestSnapshot,
      response: responseSnapshot,
    },
  });
}

export function applyEnvironmentMutations(
  environment: Record<string, string>,
  mutations: Record<string, string | null>,
) {
  for (const [key, value] of Object.entries(mutations)) {
    if (value === null) delete environment[key];
    else environment[key] = value;
  }
}

export function applyHeaderMutations(
  headers: Record<string, string>,
  mutations: Record<string, string | null>,
) {
  for (const [key, value] of Object.entries(mutations)) {
    const existing = Object.keys(headers).find((name) => name.toLowerCase() === key.toLowerCase());
    if (value === null) {
      if (existing) delete headers[existing];
    } else {
      if (existing && existing !== key) delete headers[existing];
      headers[key] = value;
    }
  }
}
