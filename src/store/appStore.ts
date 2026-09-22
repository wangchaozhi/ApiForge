import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createId } from '../lib/id';
import type {
  ApiCollection,
  ApiRequest,
  ApiResponse,
  HistoryEntry,
  KeyValue,
  MultipartField,
  NetworkSettings,
  RequestRuntime,
  WorkspaceView,
} from '../types/api';

const emptyRow = (): KeyValue => ({ id: createId('kv'), key: '', value: '', enabled: true });
const emptyMultipartRow = (): MultipartField => ({
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

const starterRequest: ApiRequest = {
  id: createId('req'),
  name: 'Get JSONPlaceholder post',
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
  name: 'My Collection',
  requestIds: [starterRequest.id],
  folders: [],
};

const emptyRuntime = (): RequestRuntime => ({ response: null, error: null, sending: false, operationId: null });

function newRequest(name = 'Untitled Request'): ApiRequest {
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

function normalizeRequest(request: ApiRequest): ApiRequest {
  return {
    ...request,
    auth: request.auth ?? { type: 'none' },
    formFields: request.formFields?.length ? request.formFields : [emptyRow()],
    multipartFields: request.multipartFields?.length ? request.multipartFields : [emptyMultipartRow()],
  };
}

function normalizeCollections(collections: ApiCollection[] | undefined, requests: ApiRequest[]) {
  if (!collections?.length) {
    return [{ id: createId('col'), name: 'My Collection', requestIds: requests.map((item) => item.id), folders: [] }];
  }
  const valid = new Set(requests.map((item) => item.id));
  return collections.map((collection) => ({
    ...collection,
    requestIds: (collection.requestIds ?? []).filter((id) => valid.has(id)),
    folders: (collection.folders ?? []).map((folder) => ({
      ...folder,
      requestIds: (folder.requestIds ?? []).filter((id) => valid.has(id)),
    })),
  }));
}

export type CreateTarget = { collectionId?: string; folderId?: string };


function removeRequestFromCollections(collections: ApiCollection[], requestId: string) {
  return collections.map((collection) => ({
    ...collection,
    requestIds: collection.requestIds.filter((id) => id !== requestId),
    folders: collection.folders.map((folder) => ({
      ...folder,
      requestIds: folder.requestIds.filter((id) => id !== requestId),
    })),
  }));
}

function addRequestToTarget(collections: ApiCollection[], requestId: string, target: CreateTarget = {}) {
  if (!target.collectionId) return collections;
  return collections.map((collection) => {
    if (collection.id !== target.collectionId) return collection;
    if (target.folderId) {
      return {
        ...collection,
        folders: collection.folders.map((folder) =>
          folder.id === target.folderId && !folder.requestIds.includes(requestId)
            ? { ...folder, requestIds: [...folder.requestIds, requestId] }
            : folder,
        ),
      };
    }
    return collection.requestIds.includes(requestId)
      ? collection
      : { ...collection, requestIds: [...collection.requestIds, requestId] };
  });
}

function findRequestTarget(collections: ApiCollection[], requestId: string): CreateTarget {
  for (const collection of collections) {
    if (collection.requestIds.includes(requestId)) return { collectionId: collection.id };
    const folder = collection.folders.find((item) => item.requestIds.includes(requestId));
    if (folder) return { collectionId: collection.id, folderId: folder.id };
  }
  return {};
}

type AppState = {
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

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      requests: [starterRequest],
      collections: [starterCollection],
      openRequestIds: [starterRequest.id],
      activeRequestId: starterRequest.id,
      activeView: 'collections',
      environments: { name: 'ApiForge' },
      networkSettings: defaultNetworkSettings,
      history: [],
      runtimeByRequest: { [starterRequest.id]: emptyRuntime() },
      setActiveRequest: (id) =>
        set((state) => ({
          activeRequestId: id,
          openRequestIds: state.openRequestIds.includes(id) ? state.openRequestIds : [...state.openRequestIds, id],
          activeView: 'collections',
        })),
      setActiveView: (view) => set({ activeView: view }),
      closeRequest: (id) =>
        set((state) => {
          const index = state.openRequestIds.indexOf(id);
          const openRequestIds = state.openRequestIds.filter((item) => item !== id);
          const fallback = openRequestIds[Math.min(Math.max(index - 1, 0), Math.max(openRequestIds.length - 1, 0))];
          return {
            openRequestIds,
            activeRequestId: state.activeRequestId === id ? (fallback ?? '') : state.activeRequestId,
          };
        }),
      createRequest: (target = {}) =>
        set((state) => {
          const request = newRequest();
          let collections = state.collections;
          const collectionId = target.collectionId ?? state.collections[0]?.id;
          if (collectionId) {
            collections = state.collections.map((collection) => {
              if (collection.id !== collectionId) return collection;
              if (target.folderId) {
                return {
                  ...collection,
                  folders: collection.folders.map((folder) =>
                    folder.id === target.folderId ? { ...folder, requestIds: [...folder.requestIds, request.id] } : folder,
                  ),
                };
              }
              return { ...collection, requestIds: [...collection.requestIds, request.id] };
            });
          }
          return {
            requests: [...state.requests, request],
            collections,
            openRequestIds: [...state.openRequestIds, request.id],
            activeRequestId: request.id,
            activeView: 'collections',
            runtimeByRequest: { ...state.runtimeByRequest, [request.id]: emptyRuntime() },
          };
        }),
      deleteRequest: (id) =>
        set((state) => {
          const requests = state.requests.filter((item) => item.id !== id);
          const collections = state.collections.map((collection) => ({
            ...collection,
            requestIds: collection.requestIds.filter((requestId) => requestId !== id),
            folders: collection.folders.map((folder) => ({ ...folder, requestIds: folder.requestIds.filter((requestId) => requestId !== id) })),
          }));
          const openRequestIds = state.openRequestIds.filter((requestId) => requestId !== id);
          const runtimeByRequest = { ...state.runtimeByRequest };
          delete runtimeByRequest[id];
          return {
            requests,
            collections,
            openRequestIds,
            runtimeByRequest,
            activeRequestId: state.activeRequestId === id ? (openRequestIds[0] ?? '') : state.activeRequestId,
          };
        }),
      importRequest: (request, response = null) =>
        set((state) => {
          const imported = normalizeRequest({ ...request, id: createId('req') });
          const collectionId = state.collections[0]?.id;
          const collections = collectionId
            ? state.collections.map((collection) => collection.id === collectionId
              ? { ...collection, requestIds: [...collection.requestIds, imported.id] }
              : collection)
            : state.collections;
          return {
            requests: [...state.requests, imported],
            collections,
            openRequestIds: [...state.openRequestIds, imported.id],
            activeRequestId: imported.id,
            activeView: 'collections',
            runtimeByRequest: {
              ...state.runtimeByRequest,
              [imported.id]: { ...emptyRuntime(), response },
            },
          };
        }),
      updateActiveRequest: (updater) =>
        set((state) => ({
          requests: state.requests.map((request) =>
            request.id === state.activeRequestId ? normalizeRequest(updater(normalizeRequest(request))) : request,
          ),
        })),
      startRequest: (requestId, operationId) =>
        set((state) => ({
          runtimeByRequest: {
            ...state.runtimeByRequest,
            [requestId]: { response: null, error: null, sending: true, operationId },
          },
        })),
      completeRequest: (requestId, response) =>
        set((state) => ({
          runtimeByRequest: {
            ...state.runtimeByRequest,
            [requestId]: { response, error: null, sending: false, operationId: null },
          },
        })),
      failRequest: (requestId, error) =>
        set((state) => ({
          runtimeByRequest: {
            ...state.runtimeByRequest,
            [requestId]: { response: null, error, sending: false, operationId: null },
          },
        })),
      createCollection: (name = 'New Collection') => {
        const id = createId('col');
        set((state) => ({ collections: [...state.collections, { id, name, requestIds: [], folders: [] }] }));
        return id;
      },
      renameCollection: (id, name) => set((state) => ({
        collections: state.collections.map((collection) => collection.id === id ? { ...collection, name: name.trim() || collection.name } : collection),
      })),
      deleteCollection: (id) => set((state) => ({ collections: state.collections.filter((collection) => collection.id !== id) })),
      createFolder: (collectionId, name = 'New Folder') => {
        const id = createId('folder');
        set((state) => ({
          collections: state.collections.map((collection) => collection.id === collectionId
            ? { ...collection, folders: [...collection.folders, { id, name, requestIds: [] }] }
            : collection),
        }));
        return id;
      },
      renameFolder: (collectionId, folderId, name) => set((state) => ({
        collections: state.collections.map((collection) => collection.id === collectionId
          ? {
              ...collection,
              folders: collection.folders.map((folder) => folder.id === folderId ? { ...folder, name: name.trim() || folder.name } : folder),
            }
          : collection),
      })),
      deleteFolder: (collectionId, folderId) => set((state) => ({
        collections: state.collections.map((collection) => {
          if (collection.id !== collectionId) return collection;
          const folder = collection.folders.find((item) => item.id === folderId);
          return {
            ...collection,
            requestIds: folder ? [...collection.requestIds, ...folder.requestIds.filter((id) => !collection.requestIds.includes(id))] : collection.requestIds,
            folders: collection.folders.filter((item) => item.id !== folderId),
          };
        }),
      })),
      setEnvironment: (key, value) => set((state) => ({ environments: { ...state.environments, [key]: value } })),
      removeEnvironment: (key) => set((state) => {
        const environments = { ...state.environments };
        delete environments[key];
        return { environments };
      }),
      replaceEnvironmentKey: (oldKey, newKey) => set((state) => {
        const trimmed = newKey.trim();
        if (!trimmed || trimmed === oldKey) return state;
        const environments = { ...state.environments };
        const value = environments[oldKey] ?? '';
        delete environments[oldKey];
        environments[trimmed] = value;
        return { environments };
      }),
      updateNetworkSettings: (settings) => set((state) => ({ networkSettings: { ...state.networkSettings, ...settings } })),
      resetNetworkSettings: () => set({ networkSettings: defaultNetworkSettings }),
      setHistory: (history) => set({ history }),
      prependHistory: (entry) => set((state) => ({ history: [entry, ...state.history.filter((item) => item.id !== entry.id)].slice(0, 200) })),
      reorderCollections: (sourceId, targetId) => set((state) => {
        if (sourceId === targetId) return state;
        const sourceIndex = state.collections.findIndex((item) => item.id === sourceId);
        const targetIndex = state.collections.findIndex((item) => item.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return state;
        const collections = [...state.collections];
        const [source] = collections.splice(sourceIndex, 1);
        const nextTargetIndex = collections.findIndex((item) => item.id === targetId);
        collections.splice(nextTargetIndex, 0, source);
        return { collections };
      }),
      duplicateRequest: (id) => {
        let duplicatedId: string | null = null;
        set((state) => {
          const source = state.requests.find((request) => request.id === id);
          if (!source) return state;
          const duplicate = normalizeRequest({
            ...structuredClone(source),
            id: createId('req'),
            name: `${source.name} Copy`,
          });
          duplicatedId = duplicate.id;
          const target = findRequestTarget(state.collections, id);
          const collections = addRequestToTarget(state.collections, duplicate.id, target);
          return {
            requests: [...state.requests, duplicate],
            collections,
            openRequestIds: [...state.openRequestIds, duplicate.id],
            activeRequestId: duplicate.id,
            activeView: 'collections',
            runtimeByRequest: { ...state.runtimeByRequest, [duplicate.id]: emptyRuntime() },
          };
        });
        return duplicatedId;
      },
      moveRequest: (id, target = {}) => set((state) => ({
        collections: addRequestToTarget(removeRequestFromCollections(state.collections, id), id, target),
      })),
      importCollection: (collection, importedRequests) => set((state) => {
        const normalizedRequests = importedRequests.map(normalizeRequest);
        const firstRequestId = normalizedRequests[0]?.id ?? '';
        return {
          requests: [...state.requests, ...normalizedRequests],
          collections: [...state.collections, collection],
          openRequestIds: firstRequestId ? [...state.openRequestIds, firstRequestId] : state.openRequestIds,
          activeRequestId: firstRequestId || state.activeRequestId,
          activeView: 'collections',
          runtimeByRequest: {
            ...state.runtimeByRequest,
            ...Object.fromEntries(normalizedRequests.map((request) => [request.id, emptyRuntime()])),
          },
        };
      }),
    }),
    {
      name: 'apiforge-workspace-v2',
      partialize: (state) => ({
        requests: state.requests,
        collections: state.collections,
        openRequestIds: state.openRequestIds,
        activeRequestId: state.activeRequestId,
        environments: state.environments,
        networkSettings: state.networkSettings,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppState>;
        const requests = saved.requests?.length ? saved.requests.map(normalizeRequest) : current.requests;
        const collections = normalizeCollections(saved.collections, requests);
        const valid = new Set(requests.map((item) => item.id));
        const openRequestIds = (saved.openRequestIds ?? []).filter((id) => valid.has(id));
        const preferredActive = saved.activeRequestId && valid.has(saved.activeRequestId) ? saved.activeRequestId : '';
        const activeRequestId = preferredActive || openRequestIds[0] || requests[0]?.id || '';
        const finalOpenIds = activeRequestId && !openRequestIds.includes(activeRequestId) ? [...openRequestIds, activeRequestId] : openRequestIds;
        return {
          ...current,
          ...saved,
          requests,
          collections,
          openRequestIds: finalOpenIds,
          activeRequestId,
          networkSettings: { ...defaultNetworkSettings, ...(saved.networkSettings ?? {}) },
          activeView: 'collections',
          history: [],
          runtimeByRequest: Object.fromEntries(requests.map((request) => [request.id, emptyRuntime()])),
        };
      },
    },
  ),
);
