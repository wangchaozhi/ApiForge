export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type KeyValue = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type MultipartField = KeyValue & {
  kind: 'text' | 'file';
  fileName?: string;
};

export type BodyType = 'none' | 'json' | 'raw' | 'form-urlencoded' | 'form-data';

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; key: string; value: string; addTo: 'header' | 'query' }
  | {
      type: 'oauth2';
      flow: 'authorization-code' | 'client-credentials';
      authorizationUrl: string;
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scopes: string;
      usePkce: boolean;
      accessToken: string;
    };

export type NetworkSettings = {
  timeoutMs: number;
  followRedirects: boolean;
  verifyTls: boolean;
  cookiesEnabled: boolean;
  useSystemProxy: boolean;
  proxyUrl: string;
};

export type EnvironmentVariable = {
  value: string;
  secret: boolean;
};

export type EnvironmentProfile = {
  id: string;
  name: string;
  variables: Record<string, EnvironmentVariable>;
};

export type ApiRequest = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
  formFields: KeyValue[];
  multipartFields: MultipartField[];
  auth: AuthConfig;
  preRequestScript?: string;
  testScript?: string;
};

export type ApiFolder = {
  id: string;
  name: string;
  requestIds: string[];
};

export type ApiCollection = {
  id: string;
  name: string;
  requestIds: string[];
  folders: ApiFolder[];
};

export type EngineField = { key: string; value: string };
export type EngineMultipartField = EngineField & { kind: 'text' | 'file'; fileName?: string };

export type EngineBody =
  | { type: 'none' }
  | { type: 'text'; content: string }
  | { type: 'urlencoded'; fields: EngineField[] }
  | { type: 'multipart'; fields: EngineMultipartField[] };

export type EngineRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: EngineBody;
  network: NetworkSettings;
};

export type ApiResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding?: 'utf8' | 'base64';
  elapsedMs: number;
  sizeBytes: number;
};

export type RequestRuntime = {
  response: ApiResponse | null;
  error: string | null;
  sending: boolean;
  operationId: string | null;
};

export type HistoryEntry = {
  id: string;
  requestId: string;
  requestName: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  elapsedMs: number;
  sizeBytes: number;
  requestJson: string;
  responseJson: string;
  createdAt: string;
};

export type CookieInfo = {
  domain: string;
  path: string;
  name: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  expires: string | null;
};

export type WorkspaceView = 'collections' | 'runner' | 'history' | 'environments' | 'cookies' | 'settings';
