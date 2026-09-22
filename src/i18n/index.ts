import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { resolveLocale, translateMessage, type LanguagePreference, type MessageParams } from './core';
import type { MessageKey } from './messages';

const systemLanguage = () => typeof navigator === 'undefined' ? 'en' : navigator.language;

type LanguageState = {
  preference: LanguagePreference;
  systemLanguage: string;
  setPreference: (preference: LanguagePreference) => void;
  refreshSystemLanguage: () => void;
};

export const useLanguageStore = create<LanguageState>()(persist((set) => ({
  preference: 'system',
  systemLanguage: systemLanguage(),
  setPreference: (preference) => set({ preference }),
  refreshSystemLanguage: () => set({ systemLanguage: systemLanguage() }),
}), {
  name: 'apiforge-language-v1',
  partialize: (state) => ({ preference: state.preference }),
  merge: (persisted, current) => {
    const preference = (persisted as { preference?: unknown } | null)?.preference;
    return { ...current, preference: preference === 'en' || preference === 'zh-CN' ? preference : 'system' };
  },
}));

export function useLocale() {
  return useLanguageStore((state) => resolveLocale(state.preference, state.systemLanguage));
}

/** For event handlers, helpers and store actions; UI callers subscribe with useLocale. */
export function translate(key: MessageKey, params?: MessageParams): string {
  const state = useLanguageStore.getState();
  return translateMessage(resolveLocale(state.preference, state.systemLanguage), key, params);
}
