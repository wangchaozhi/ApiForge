import { createWorkspaceSlice } from './slices/workspace.ts';
import { createEnvironmentsSlice } from './slices/environments.ts';
import type { StateCreator } from 'zustand';
import type { AppState } from './types.ts';
import { createStarterWorkspace, defaultNetworkSettings, emptyRuntime } from './defaults.ts';
import { createRequestsSlice } from './slices/requests.ts';
import { createCollectionsSlice } from './slices/collections.ts';
import { createRuntimeSlice } from './slices/runtime.ts';
import { createPreferencesSlice } from './slices/preferences.ts';
import { createHistorySlice } from './slices/history.ts';

export const createAppState: StateCreator<AppState> = (set) => {
  const { starterRequest, starterCollection, starterEnvironment } = createStarterWorkspace();
  return {
  requests: [starterRequest],
  collections: [starterCollection],
  openRequestIds: [starterRequest.id],
  activeRequestId: starterRequest.id,
  activeView: 'collections',
  environmentProfiles: [starterEnvironment],
  activeEnvironmentId: starterEnvironment.id,
  networkSettings: defaultNetworkSettings,
  history: [],
  runtimeByRequest: { [starterRequest.id]: emptyRuntime() },
    ...createEnvironmentsSlice(set),
    ...createWorkspaceSlice(set),
    ...createRequestsSlice(set),
    ...createCollectionsSlice(set),
    ...createRuntimeSlice(set),
    ...createPreferencesSlice(set),
    ...createHistorySlice(set),
  };
};
