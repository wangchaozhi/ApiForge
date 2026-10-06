// Compatibility exports; implementation modules use direct domain imports.
export type { HttpMethod, KeyValue, MultipartField, BodyType, AuthConfig, ApiRequest } from '../domain/request.ts';
export type { NetworkSettings } from '../domain/network.ts';
export type { ApiFolder, ApiCollection, WorkspaceView } from '../domain/workspace.ts';
export type { ApiResponse, RequestRuntime } from '../domain/response.ts';
export type { HistoryEntry } from '../domain/history.ts';
export type { CookieInfo } from '../domain/cookies.ts';
export type { EngineField, EngineMultipartField, EngineBody, EngineRequest } from '../domain/engine.ts';
export type { EnvironmentVariable, EnvironmentProfile } from '../domain/environment.ts';
