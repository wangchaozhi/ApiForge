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
