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
  | { type: 'digest'; username: string; password: string }
  | { type: 'apiKey'; key: string; value: string; addTo: 'header' | 'query' }
  | {
      type: 'oauth2';
      flow: 'authorization-code' | 'client-credentials';
      authorizationUrl: string;
      tokenUrl: string;
      redirectUri: string;
      clientId: string;
      clientSecret: string;
      scopes: string;
      usePkce: boolean;
      accessToken: string;
      refreshToken: string;
      expiresAt: number | null;
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
