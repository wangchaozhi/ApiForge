import type { StoreApi } from 'zustand';
import type { ApiCollection, WorkspaceView } from '../domain/workspace.ts';
import type { ApiRequest, KeyValue, MultipartField } from '../domain/request.ts';
import type { ApiResponse, RequestRuntime } from '../domain/response.ts';
import type { HistoryEntry } from '../domain/history.ts';
import type { NetworkSettings } from '../domain/network.ts';

export type CreateTarget = { collectionId?: string; folderId?: string };

export type AppState = {
  requests: ApiRequest[];
  collections: ApiCollection[];
  openRequestIds: string[];
  activeRequestId: string;
  activeView: WorkspaceView;
  environments: Record<string, string>;
  networkSettings: NetworkSettings;
  history: HistoryEntry[];
  runtimeByRequest: Record<string, RequestRuntime>;
  setActiveRequest: (id: string) => void;
  setActiveView: (view: WorkspaceView) => void;
  closeRequest: (id: string) => void;
  createRequest: (target?: CreateTarget) => void;
  deleteRequest: (id: string) => void;
  importRequest: (request: ApiRequest, response?: ApiResponse | null) => void;
  updateActiveRequest: (updater: (request: ApiRequest) => ApiRequest) => void;
  startRequest: (requestId: string, operationId: string) => void;
  completeRequest: (requestId: string, response: ApiResponse) => void;
  failRequest: (requestId: string, error: string) => void;
  createCollection: (name?: string) => string;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  createFolder: (collectionId: string, name?: string) => string;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
  setEnvironment: (key: string, value: string) => void;
  removeEnvironment: (key: string) => void;
  replaceEnvironmentKey: (oldKey: string, newKey: string) => void;
  updateNetworkSettings: (settings: Partial<NetworkSettings>) => void;
  resetNetworkSettings: () => void;
  setHistory: (history: HistoryEntry[]) => void;
  prependHistory: (entry: HistoryEntry) => void;
  reorderCollections: (sourceId: string, targetId: string) => void;
  duplicateRequest: (id: string) => string | null;
  moveRequest: (id: string, target?: CreateTarget) => void;
  importCollection: (collection: ApiCollection, importedRequests: ApiRequest[]) => void;
};


export type AppSlice<K extends keyof AppState> = (set: StoreApi<AppState>['setState']) => Pick<AppState, K>;
