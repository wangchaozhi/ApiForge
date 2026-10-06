import { translate as t } from '../../i18n/index.ts';
import { createId } from '../../lib/id.ts';
import { newRequest, normalizeRequest, emptyRuntime } from '../defaults.ts';
import { addRequestToTarget, removeRequestFromCollections, findRequestTarget } from '../collections.ts';
import type { AppSlice } from '../types.ts';

export const createRequestsSlice: AppSlice<'setActiveRequest' | 'closeRequest' | 'createRequest' | 'deleteRequest' | 'importRequest' | 'updateActiveRequest' | 'duplicateRequest' | 'moveRequest' | 'importCollection'> = (set) => ({
  setActiveRequest: (id) =>
    set((state) => ({
      activeRequestId: id,
      openRequestIds: state.openRequestIds.includes(id) ? state.openRequestIds : [...state.openRequestIds, id],
      activeView: 'collections',
    })),
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
      const collections = addRequestToTarget(state.collections, request.id, {
        ...target,
        collectionId: target.collectionId ?? state.collections[0]?.id,
      });
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
      const collections = removeRequestFromCollections(state.collections, id);
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
  duplicateRequest: (id) => {
    let duplicatedId: string | null = null;
    set((state) => {
      const source = state.requests.find((request) => request.id === id);
      if (!source) return state;
      const duplicate = normalizeRequest({
        ...structuredClone(source),
        id: createId('req'),
        name: t('{name} Copy', { name: source.name }),
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
});
