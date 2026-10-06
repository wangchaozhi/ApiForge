import type { PersistOptions } from 'zustand/middleware';
import type { AppState } from './types.ts';
import { normalizeRequest, emptyRuntime, defaultNetworkSettings } from './defaults.ts';
import { normalizeCollections } from './collections.ts';

export type PersistedWorkspace = Pick<AppState, 'requests' | 'collections' | 'openRequestIds' | 'activeRequestId' | 'environments' | 'networkSettings'>;

export const workspacePersistence: PersistOptions<AppState, PersistedWorkspace> = {
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
};
