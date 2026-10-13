import { useEffect } from 'react';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, isCheckDue, isUpdaterSupported } from '../../services/updater.ts';
import { useUpdateStore } from './updateStore.ts';

/** Checks for updates shortly after launch and then periodically, while enabled. */
export function useAutoUpdate() {
  const autoCheck = useUpdateStore((state) => state.autoCheck);

  useEffect(() => {
    if (!autoCheck || !isUpdaterSupported()) return;
    const run = () => {
      const { lastCheckedAt, check } = useUpdateStore.getState();
      // Launch always checks; the interval only re-checks once a full period has passed.
      if (isCheckDue(lastCheckedAt, Date.now(), CHECK_INTERVAL_MS - 60_000)) void check({ silent: true });
    };
    const first = window.setTimeout(() => void useUpdateStore.getState().check({ silent: true }), FIRST_CHECK_DELAY_MS);
    const interval = window.setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [autoCheck]);
}
