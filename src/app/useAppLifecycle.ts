import { useEffect } from 'react';
import { useLocale, useLanguageStore } from '../i18n/index.ts';
import { useAppStore } from '../store/appStore.ts';
import { loadHistory } from '../services/history.ts';
import { useAutoUpdate } from '../features/updates/useAutoUpdate.ts';

export function useAppLifecycle() {
  const locale = useLocale();
  useAutoUpdate();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const refresh = useLanguageStore.getState().refreshSystemLanguage;
    window.addEventListener('languagechange', refresh);
    return () => window.removeEventListener('languagechange', refresh);
  }, []);
  const history = useAppStore((state) => state.history);
  const setHistory = useAppStore((state) => state.setHistory);

  useEffect(() => {
    if (history.length) return;
    void loadHistory(200).then(setHistory).catch(() => undefined);
  }, [history.length, setHistory]);

}
