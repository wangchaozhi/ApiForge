import { defaultNetworkSettings } from '../defaults.ts';
import type { AppSlice } from '../types.ts';

export const createPreferencesSlice: AppSlice<'setActiveView' | 'setEnvironment' | 'removeEnvironment' | 'replaceEnvironmentKey' | 'updateNetworkSettings' | 'resetNetworkSettings'> = (set) => ({
  setActiveView: (view) => set({ activeView: view }),
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
});
