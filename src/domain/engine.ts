import type { NetworkSettings } from './network.ts';

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
  digestAuth?: { username: string; password: string };
};
