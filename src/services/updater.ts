import { isTauriRuntime } from '../platform/runtime.ts';

/** Background checks run this long after launch, then on this interval. */
export const FIRST_CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateProgress = { downloaded: number; total?: number };

export type AvailableUpdate = {
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
  install: (onProgress: (progress: UpdateProgress) => void) => Promise<void>;
};

export function isUpdaterSupported() {
  return isTauriRuntime();
}

/** Whether a background check is due, given when the last one finished. */
export function isCheckDue(lastCheckedAt: number | null, now: number, intervalMs = CHECK_INTERVAL_MS) {
  return lastCheckedAt === null || now - lastCheckedAt >= intervalMs;
}

/** Download progress as a whole percentage, or null while the size is unknown. */
export function progressPercent(progress: UpdateProgress | null) {
  if (!progress?.total) return null;
  return Math.min(100, Math.floor((progress.downloaded / progress.total) * 100));
}

/** Asks the signed release channel for a newer version; resolves null when up to date. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isUpdaterSupported()) throw new Error('Updates require the desktop runtime.');
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? undefined,
    date: update.date ?? undefined,
    install: async (onProgress) => {
      let downloaded = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? undefined;
        if (event.event === 'Progress') downloaded += event.data.chunkLength;
        onProgress({ downloaded, total });
      });
    },
  };
}

/** Restarts into the installed version. On Windows the installer has already closed the app. */
export async function relaunchApp() {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

export async function currentAppVersion() {
  if (!isUpdaterSupported()) return null;
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
