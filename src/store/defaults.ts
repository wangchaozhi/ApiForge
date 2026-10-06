import { translate as t } from '../i18n/index.ts';
import { createId } from '../lib/id.ts';
import type { ApiCollection } from '../domain/workspace.ts';
import type { ApiRequest, KeyValue, MultipartField } from '../domain/request.ts';
import type { RequestRuntime } from '../domain/response.ts';
import type { NetworkSettings } from '../domain/network.ts';

export const emptyRow = (): KeyValue => ({ id: createId('kv'), key: '', value: '', enabled: true });
export const emptyMultipartRow = (): MultipartField => ({
  id: createId('mp'),
  key: '',
  value: '',
  enabled: true,
  kind: 'text',
});

export const defaultNetworkSettings: NetworkSettings = {
  timeoutMs: 30000,
  followRedirects: true,
  verifyTls: true,
  cookiesEnabled: true,
  useSystemProxy: true,
  proxyUrl: '',
};

export const emptyRuntime = (): RequestRuntime => ({ response: null, error: null, sending: false, operationId: null });

export function newRequest(name = t("Untitled Request")): ApiRequest {
  return {
    id: createId('req'),
    name,
    method: 'GET',
    url: 'https://example.com',
    params: [emptyRow()],
    headers: [emptyRow()],
    bodyType: 'none',
    body: '',
    formFields: [emptyRow()],
    multipartFields: [emptyMultipartRow()],
    auth: { type: 'none' },
  };
}

export function normalizeRequest(request: ApiRequest): ApiRequest {
  return {
    ...request,
    auth: request.auth ?? { type: 'none' },
    formFields: request.formFields?.length ? request.formFields : [emptyRow()],
    multipartFields: request.multipartFields?.length ? request.multipartFields : [emptyMultipartRow()],
  };
}


export function createStarterWorkspace() {
  const starterRequest: ApiRequest = {
    id: createId('req'),
    name: t("Get JSONPlaceholder post"),
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    params: [emptyRow()],
    headers: [
      { id: createId('kv'), key: 'Accept', value: 'application/json', enabled: true },
      emptyRow(),
    ],
    bodyType: 'none',
    body: '{\n  "hello": "{{name}}"\n}',
    formFields: [emptyRow()],
    multipartFields: [emptyMultipartRow()],
    auth: { type: 'none' },
  };

  const starterCollection: ApiCollection = {
    id: createId('col'),
    name: t("My Collection"),
    requestIds: [starterRequest.id],
    folders: [],
  };

  return { starterRequest, starterCollection };
}
