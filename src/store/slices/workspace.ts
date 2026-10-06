import { normalizeRequest, defaultNetworkSettings, emptyRuntime } from '../defaults.ts';
import { normalizeCollections } from '../collections.ts';
import type { AppSlice } from '../types.ts';

export const createWorkspaceSlice: AppSlice<'replaceWorkspace'> = (set) => ({
  replaceWorkspace: (data) => set((state) => {
    const requests = data.requests.map(normalizeRequest);
    const collections = normalizeCollections(data.collections, requests);
    const environmentProfiles = data.environmentProfiles.length ? data.environmentProfiles : state.environmentProfiles;
    const activeEnvironmentId = environmentProfiles.some((profile) => profile.id === data.activeEnvironmentId)
      ? data.activeEnvironmentId
      : (environmentProfiles[0]?.id ?? '');
    const activeRequestId = requests[0]?.id ?? '';
    return {
      requests,
      collections,
      environmentProfiles,
      activeEnvironmentId,
      networkSettings: { ...defaultNetworkSettings, ...data.networkSettings },
      openRequestIds: activeRequestId ? [activeRequestId] : [],
      activeRequestId,
      activeView: 'collections',
      runtimeByRequest: Object.fromEntries(requests.map((request) => [request.id, emptyRuntime()])),
    };
  }),
});
