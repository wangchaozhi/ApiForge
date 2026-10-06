import { defaultNetworkSettings } from '../defaults.ts';
import type { AppSlice } from '../types.ts';

export const createPreferencesSlice: AppSlice<'setActiveView' | 'updateNetworkSettings' | 'resetNetworkSettings'> = (set) => ({
  setActiveView: (view) => set({ activeView: view }),
  updateNetworkSettings: (settings) => set((state) => ({ networkSettings: { ...state.networkSettings, ...settings } })),
  resetNetworkSettings: () => set({ networkSettings: defaultNetworkSettings }),
});
