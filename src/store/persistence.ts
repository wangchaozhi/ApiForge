import type { PersistOptions } from 'zustand/middleware';
import type { AppState } from './types.ts';
import { createId } from '../lib/id.ts';
import { redactAuthSecrets } from '../lib/auth.ts';
import { normalizeRequest, emptyRuntime, defaultNetworkSettings } from './defaults.ts';
import { normalizeCollections } from './collections.ts';

export type PersistedWorkspace = Pick<AppState, 'requests' | 'collections' | 'openRequestIds' | 'activeRequestId' | 'environmentProfiles' | 'activeEnvironmentId' | 'networkSettings'>;

export const workspacePersistence: PersistOptions<AppState, PersistedWorkspace> = {
  name: 'apiforge-workspace-v2',
  partialize: (state) => ({
    requests: state.requests.map((request) => ({ ...request, auth: redactAuthSecrets(request.auth) })),
    collections: state.collections,
    openRequestIds: state.openRequestIds,
    activeRequestId: state.activeRequestId,
    environmentProfiles: state.environmentProfiles.map((profile) => ({
      ...profile,
      variables: Object.fromEntries(Object.entries(profile.variables).map(([key, variable]) => [
        key,
        variable.secret ? { ...variable, value: '' } : variable,
      ])),
    })),
    activeEnvironmentId: state.activeEnvironmentId,
    networkSettings: {
      ...state.networkSettings,
      proxyPassword: '',
      clientCertificatePassword: '',
    },
  }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<AppState>;
    const legacyEnvironments = (persisted as Partial<AppState> & { environments?: Record<string, string> }).environments;
    const requests = saved.requests?.length ? saved.requests.map(normalizeRequest) : current.requests;
    const collections = normalizeCollections(saved.collections, requests);
    const valid = new Set(requests.map((item) => item.id));
    const openRequestIds = (saved.openRequestIds ?? []).filter((id) => valid.has(id));
    const preferredActive = saved.activeRequestId && valid.has(saved.activeRequestId) ? saved.activeRequestId : '';
    const activeRequestId = preferredActive || openRequestIds[0] || requests[0]?.id || '';
    const finalOpenIds = activeRequestId && !openRequestIds.includes(activeRequestId) ? [...openRequestIds, activeRequestId] : openRequestIds;
    const migratedLegacyProfile = legacyEnvironments
      ? [{
          id: createId('env'),
          name: 'Default',
          variables: Object.fromEntries(Object.entries(legacyEnvironments).map(([key, value]) => [key, { value, secret: false }])),
        }]
      : [];
    const environmentProfiles = saved.environmentProfiles?.length
      ? saved.environmentProfiles
      : (migratedLegacyProfile.length ? migratedLegacyProfile : current.environmentProfiles);
    const activeEnvironmentId = saved.activeEnvironmentId && environmentProfiles.some((profile) => profile.id === saved.activeEnvironmentId)
      ? saved.activeEnvironmentId
      : (environmentProfiles[0]?.id ?? '');
    return {
      ...current,
      ...saved,
      requests,
      collections,
      openRequestIds: finalOpenIds,
      activeRequestId,
      environmentProfiles,
      activeEnvironmentId,
      networkSettings: { ...defaultNetworkSettings, ...(saved.networkSettings ?? {}) },
      activeView: 'collections',
      history: [],
      runtimeByRequest: Object.fromEntries(requests.map((request) => [request.id, emptyRuntime()])),
    };
  },
};
