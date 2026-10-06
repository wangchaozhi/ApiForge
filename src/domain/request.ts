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
  | { type: 'apiKey'; key: string; value: string; addTo: 'header' | 'query' };

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
};
