import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createAppState } from './createAppState.ts';
import { workspacePersistence } from './persistence.ts';
import type { AppState } from './types.ts';

export { defaultNetworkSettings } from './defaults.ts';
export type { CreateTarget } from './types.ts';

export const useAppStore = create<AppState>()(persist(createAppState, workspacePersistence));
