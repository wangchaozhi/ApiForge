import type { AppSlice } from '../types.ts';

export const createHistorySlice: AppSlice<'setHistory' | 'prependHistory'> = (set) => ({
  setHistory: (history) => set({ history }),
  prependHistory: (entry) => set((state) => ({ history: [entry, ...state.history.filter((item) => item.id !== entry.id)].slice(0, 200) })),
});
