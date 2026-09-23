import { redactAuthSecrets } from './auth';
import { createId } from './id';
import type {
  ApiCollection,
  ApiRequest,
  AuthConfig,
  BodyType,
  EnvironmentProfile,
  KeyValue,
  MultipartField,
  NetworkSettings,
} from '../types/api';

type JsonRecord = Record<string, any>;

export type WorkspaceData = {
  requests: ApiRequest[];
  collections: ApiCollection[];
  environmentProfiles: EnvironmentProfile[];
  activeEnvironmentId: string;
  networkSettings: NetworkSettings;
};

export type WorkspaceSnapshotV1 = {
  schema: 'apiforge.workspace';
  schemaVersion: 1;
  exportedAt: string;
  data: WorkspaceData;
};

export type ImportedCollection = {
  collection: ApiCollection;
  requests: ApiRequest[];
};

function row(key = '', value = '', enabled = true): KeyValue {
  return { id: createId('kv'), key, value, enabled };
}

function multipartRow(key = '', value = '', kind: 'text' | 'file' = 'text', fileName?: string): MultipartField {
  return { ...row(key, value), kind, fileName };
}

function emptyRequest(name: string): ApiRequest {
  return {
    id: createId('req'),
    name,
    method: 'GET',
    url: 'https://example.com',
    params: [row()],
    headers: [row()],
    bodyType: 'none',
    body: '',
    formFields: [row()],
    multipartFields: [multipartRow()],
    auth: { type: 'none' },
  };
}

function json(source: string): JsonRecord {
  const value = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value;
}

function sanitizeProfiles(profiles: EnvironmentProfile[], includeSecrets: boolean) {
  return profiles.map((profile) => ({
    ...profile,
    variables: Object.fromEntries(
      Object.entries(profile.variables).map(([key, variable]) => [
        key,
        includeSecrets || !variable.secret ? variable : { ...variable, value: '' },
      ]),
    ),
  }));
}

export function serializeWorkspace(data: WorkspaceData, includeSecrets = false) {
  const snapshot: WorkspaceSnapshotV1 = {
    schema: 'apiforge.workspace',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      ...data,
      requests: data.requests.map((request) => ({
        ...request,
        auth: includeSecrets ? request.auth : redactAuthSecrets(request.auth),
      })),
      environmentProfiles: sanitizeProfiles(data.environmentProfiles, includeSecrets),
      networkSettings: includeSecrets
        ? data.networkSettings
        : {
            ...data.networkSettings,
            proxyPassword: '',
            clientCertificatePassword: '',
          },
    },
  };
  return JSON.stringify(snapshot, null, 2);
}

export function parseWorkspace(source: string): WorkspaceSnapshotV1 {
  const value = json(source);
  if (value.schema !== 'apiforge.workspace' || value.schemaVersion !== 1 || !value.data) {
    throw new Error('Unsupported ApiForge workspace format.');
  }
  const data = value.data as WorkspaceData;
  if (!Array.isArray(data.requests) || !Array.isArray(data.collections) || !Array.isArray(data.environmentProfiles)) {
    throw new Error('Invalid ApiForge workspace data.');
  }
  return value as WorkspaceSnapshotV1;
}

function postmanAuth(auth: JsonRecord | undefined): AuthConfig {
  if (!auth || !auth.type) return { type: 'none' };
  const read = (group: string, key: string) => {
    const entries = auth[group];
    return Array.isArray(entries) ? String(entries.find((item) => item?.key === key)?.value ?? '') : '';
  };
  if (auth.type === 'bearer') return { type: 'bearer', token: read('bearer', 'token') };
  if (auth.type === 'basic') return { type: 'basic', username: read('basic', 'username'), password: read('basic', 'password') };
  if (auth.type === 'apikey') {
    return {
      type: 'apiKey',
      key: read('apikey', 'key') || 'X-API-Key',
      value: read('apikey', 'value'),
      addTo: read('apikey', 'in') === 'query' ? 'query' : 'header',
    };
  }
  if (auth.type === 'oauth2') {
    return {
      type: 'oauth2',
      flow: read('oauth2', 'grant_type') === 'client_credentials' ? 'client-credentials' : 'authorization-code',
      authorizationUrl: read('oauth2', 'authUrl'),
      tokenUrl: read('oauth2', 'accessTokenUrl'),
      redirectUri: read('oauth2', 'redirect_uri') || read('oauth2', 'callbackUrl'),
      clientId: read('oauth2', 'clientId'),
      clientSecret: read('oauth2', 'clientSecret'),
      scopes: read('oauth2', 'scope'),
      usePkce: read('oauth2', 'challengeAlgorithm') !== '',
      accessToken: read('oauth2', 'accessToken'),
    };
  }
  return { type: 'none' };
}

function postmanUrl(request: JsonRecord) {
  if (typeof request.url === 'string') return request.url;
  if (request.url?.raw) return String(request.url.raw);
  return 'https://example.com';
}

function postmanHeaders(request: JsonRecord) {
  const headers = Array.isArray(request.header)
    ? request.header
        .filter((item: JsonRecord) => item?.key)
        .map((item: JsonRecord) => row(String(item.key), String(item.value ?? ''), !item.disabled))
    : [];
  return headers.length ? [...headers, row()] : [row()];
}

function postmanQuery(request: JsonRecord) {
  const query = request.url && typeof request.url === 'object' && Array.isArray(request.url.query)
    ? request.url.query
        .filter((item: JsonRecord) => item?.key)
        .map((item: JsonRecord) => row(String(item.key), String(item.value ?? ''), !item.disabled))
    : [];
  return query.length ? [...query, row()] : [row()];
}

function postmanBody(body: JsonRecord | undefined): Pick<ApiRequest, 'bodyType' | 'body' | 'formFields' | 'multipartFields'> {
  const base = { bodyType: 'none' as BodyType, body: '', formFields: [row()], multipartFields: [multipartRow()] };
  if (!body?.mode) return base;
  if (body.mode === 'raw') {
    const language = String(body.options?.raw?.language ?? '').toLowerCase();
    return { ...base, bodyType: language === 'json' ? 'json' : 'raw', body: String(body.raw ?? '') };
  }
  if (body.mode === 'urlencoded' && Array.isArray(body.urlencoded)) {
    return {
      ...base,
      bodyType: 'form-urlencoded',
      formFields: [
        ...body.urlencoded.filter((item: JsonRecord) => item?.key).map((item: JsonRecord) =>
          row(String(item.key), String(item.value ?? ''), !item.disabled),
        ),
        row(),
      ],
    };
  }
  if (body.mode === 'formdata' && Array.isArray(body.formdata)) {
    return {
      ...base,
      bodyType: 'form-data',
      multipartFields: [
        ...body.formdata.filter((item: JsonRecord) => item?.key).map((item: JsonRecord) => {
          const src = Array.isArray(item.src) ? item.src[0] : item.src;
          const isFile = item.type === 'file';
          const path = isFile ? String(src ?? '') : String(item.value ?? '');
          return { ...multipartRow(String(item.key), path, isFile ? 'file' : 'text', isFile ? path.split(/[\\/]/).pop() : undefined), enabled: !item.disabled };
        }),
        multipartRow(),
      ],
    };
  }
  return base;
}

function postmanEventScript(item: JsonRecord, listen: 'prerequest' | 'test') {
  const event = Array.isArray(item.event) ? item.event.find((candidate: JsonRecord) => candidate?.listen === listen) : undefined;
  const exec = event?.script?.exec;
  if (Array.isArray(exec)) return exec.join('\n');
  return typeof exec === 'string' ? exec : '';
}

function importPostmanRequest(item: JsonRecord) {
  const source = item.request ?? {};
  const request = emptyRequest(String(item.name ?? 'Imported request'));
  const body = postmanBody(source.body);
  return {
    ...request,
    method: String(source.method ?? 'GET').toUpperCase() as ApiRequest['method'],
    url: postmanUrl(source),
    params: postmanQuery(source),
    headers: postmanHeaders(source),
    auth: postmanAuth(source.auth),
    preRequestScript: postmanEventScript(item, 'prerequest'),
    testScript: postmanEventScript(item, 'test'),
    ...body,
  };
}

export function parsePostmanCollection(source: string): ImportedCollection {
  const document = json(source);
  if (!document.info || !Array.isArray(document.item)) throw new Error('Not a Postman Collection.');
  const collection: ApiCollection = {
    id: createId('col'),
    name: String(document.info.name ?? 'Postman Collection'),
    requestIds: [],
    folders: [],
  };
  const requests: ApiRequest[] = [];

  const visit = (items: JsonRecord[], path: string[] = []) => {
    for (const item of items) {
      if (item?.request) {
        const request = importPostmanRequest(item);
        requests.push(request);
        if (path.length) {
          const folderName = path.join(' / ');
          let folder = collection.folders.find((candidate) => candidate.name === folderName);
          if (!folder) {
            folder = { id: createId('folder'), name: folderName, requestIds: [] };
            collection.folders.push(folder);
          }
          folder.requestIds.push(request.id);
        } else {
          collection.requestIds.push(request.id);
        }
      } else if (Array.isArray(item?.item)) {
        visit(item.item, [...path, String(item.name ?? 'Folder')]);
      }
    }
  };

  visit(document.item);
  if (!requests.length) throw new Error('No requests found in Postman Collection.');
  return { collection, requests };
}

export function parsePostmanEnvironment(source: string): EnvironmentProfile {
  const document = json(source);
  if (!Array.isArray(document.values)) throw new Error('Not a Postman Environment.');
  return {
    id: createId('env'),
    name: String(document.name ?? 'Postman Environment'),
    variables: Object.fromEntries(
      document.values
        .filter((item: JsonRecord) => item?.key && item.enabled !== false)
        .map((item: JsonRecord) => [
          String(item.key),
          {
            value: String(item.value ?? ''),
            secret: item.type === 'secret' || item.type === 'password',
          },
        ]),
    ),
  };
}

function authToPostman(auth: AuthConfig) {
  if (auth.type === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: auth.token, type: 'string' }] };
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.username, type: 'string' },
        { key: 'password', value: auth.password, type: 'string' },
      ],
    };
  }
  if (auth.type === 'apiKey') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.key, type: 'string' },
        { key: 'value', value: auth.value, type: 'string' },
        { key: 'in', value: auth.addTo, type: 'string' },
      ],
    };
  }
  if (auth.type === 'oauth2') {
    return {
      type: 'oauth2',
      oauth2: [
        { key: 'grant_type', value: auth.flow === 'client-credentials' ? 'client_credentials' : 'authorization_code', type: 'string' },
        { key: 'authUrl', value: auth.authorizationUrl, type: 'string' },
        { key: 'accessTokenUrl', value: auth.tokenUrl, type: 'string' },
        { key: 'redirect_uri', value: auth.redirectUri, type: 'string' },
        { key: 'clientId', value: auth.clientId, type: 'string' },
        { key: 'clientSecret', value: auth.clientSecret, type: 'string' },
        { key: 'scope', value: auth.scopes, type: 'string' },
        { key: 'challengeAlgorithm', value: auth.usePkce ? 'S256' : '', type: 'string' },
        { key: 'accessToken', value: auth.accessToken, type: 'string' },
      ],
    };
  }
  return undefined;
}

function bodyToPostman(request: ApiRequest) {
  if (request.bodyType === 'json' || request.bodyType === 'raw') {
    return {
      mode: 'raw',
      raw: request.body,
      options: { raw: { language: request.bodyType === 'json' ? 'json' : 'text' } },
    };
  }
  if (request.bodyType === 'form-urlencoded') {
    return {
      mode: 'urlencoded',
      urlencoded: request.formFields.filter((item) => item.key).map((item) => ({
        key: item.key,
        value: item.value,
        disabled: !item.enabled,
        type: 'text',
      })),
    };
  }
  if (request.bodyType === 'form-data') {
    return {
      mode: 'formdata',
      formdata: request.multipartFields.filter((item) => item.key).map((item) => item.kind === 'file'
        ? { key: item.key, type: 'file', src: item.value, disabled: !item.enabled }
        : { key: item.key, type: 'text', value: item.value, disabled: !item.enabled }),
    };
  }
  return undefined;
}

function requestToPostman(request: ApiRequest) {
  const event = [
    request.preRequestScript
      ? { listen: 'prerequest', script: { type: 'text/javascript', exec: request.preRequestScript.split('\n') } }
      : null,
    request.testScript
      ? { listen: 'test', script: { type: 'text/javascript', exec: request.testScript.split('\n') } }
      : null,
  ].filter(Boolean);

  return {
    name: request.name,
    ...(event.length ? { event } : {}),
    request: {
      method: request.method,
      header: request.headers.filter((item) => item.key).map((item) => ({
        key: item.key,
        value: item.value,
        disabled: !item.enabled,
        type: 'text',
      })),
      auth: authToPostman(request.auth),
      body: bodyToPostman(request),
      url: {
        raw: request.url,
        query: request.params.filter((item) => item.key).map((item) => ({
          key: item.key,
          value: item.value,
          disabled: !item.enabled,
        })),
      },
    },
  };
}

export function serializePostmanCollection(collection: ApiCollection, requests: ApiRequest[], includeSecrets = false) {
  const byId = new Map(requests.map((request) => [request.id, includeSecrets ? request : { ...request, auth: redactAuthSecrets(request.auth) }]));
  const rootItems = collection.requestIds.flatMap((id) => {
    const request = byId.get(id);
    return request ? [requestToPostman(request)] : [];
  });
  const folders = collection.folders.map((folder) => ({
    name: folder.name,
    item: folder.requestIds.flatMap((id) => {
      const request = byId.get(id);
      return request ? [requestToPostman(request)] : [];
    }),
  }));
  return JSON.stringify({
    info: {
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [...rootItems, ...folders],
  }, null, 2);
}

export function serializePostmanEnvironment(profile: EnvironmentProfile, includeSecrets = false) {
  return JSON.stringify({
    id: profile.id,
    name: profile.name,
    values: Object.entries(profile.variables).map(([key, variable]) => ({
      key,
      value: includeSecrets || !variable.secret ? variable.value : '',
      enabled: true,
      type: variable.secret ? 'secret' : 'default',
    })),
    _postman_variable_scope: 'environment',
  }, null, 2);
}
