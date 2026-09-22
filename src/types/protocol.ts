import type { AuthConfig, KeyValue } from './api';

export type RealtimeProtocol = 'websocket' | 'sse';
export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';

export type RealtimeMessage = {
  id: string;
  direction: 'in' | 'out' | 'system';
  timestamp: string;
  data: string;
  event?: string;
};

export type WebSocketRequest = {
  id: string;
  name: string;
  url: string;
  headers: KeyValue[];
  auth: AuthConfig;
  subprotocols: string[];
};

export type SseRequest = {
  id: string;
  name: string;
  url: string;
  headers: KeyValue[];
  auth: AuthConfig;
  lastEventId?: string;
};

export type GraphqlRequest = {
  id: string;
  name: string;
  url: string;
  headers: KeyValue[];
  auth: AuthConfig;
  query: string;
  variables: string;
  operationName?: string;
};

export type GrpcRequest = {
  id: string;
  name: string;
  endpoint: string;
  service: string;
  method: string;
  metadata: KeyValue[];
  requestJson: string;
  streaming: 'unary' | 'server' | 'client' | 'bidi';
};

export type ProtocolRuntime = {
  state: ConnectionState;
  messages: RealtimeMessage[];
  error: string | null;
  startedAt: string | null;
};
