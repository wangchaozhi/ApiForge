import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { checkForUpdate, relaunchApp, type AvailableUpdate, type UpdateProgress } from '../../services/updater.ts';

export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'error';

type UpdateState = {
  autoCheck: boolean;
  lastCheckedAt: number | null;
  status: UpdateStatus;
  update: AvailableUpdate | null;
  progress: UpdateProgress | null;
  error: string | null;
  /** Version hidden with "Later" until the next launch. */
  dismissedVersion: string | null;
  setAutoCheck: (enabled: boolean) => void;
  check: (options?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
};

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const useUpdateStore = create<UpdateState>()(persist((set, get) => ({
  autoCheck: true,
  lastCheckedAt: null,
  status: 'idle',
  update: null,
  progress: null,
  error: null,
  dismissedVersion: null,
  setAutoCheck: (enabled) => set({ autoCheck: enabled }),
  check: async ({ silent = false } = {}) => {
    const { status } = get();
    if (status === 'checking' || status === 'downloading') return;
    set({ status: 'checking', error: null });
    try {
      const update = await checkForUpdate();
      set({
        status: update ? 'available' : 'upToDate',
        update,
        lastCheckedAt: Date.now(),
        // A manual check brings back a version that was dismissed with "Later".
        ...(silent ? {} : { dismissedVersion: null }),
      });
    } catch (cause) {
      // Background checks fail quietly (offline, development builds without an updater key).
      set({ status: silent ? 'idle' : 'error', error: silent ? null : message(cause) });
    }
  },
  install: async () => {
    const { update, status } = get();
    if (!update || status === 'downloading') return;
    set({ status: 'downloading', progress: { downloaded: 0 }, error: null });
    try {
      await update.install((progress) => set({ progress }));
      await relaunchApp();
    } catch (cause) {
      set({ status: 'available', progress: null, error: message(cause) });
    }
  },
  dismiss: () => set((state) => ({ dismissedVersion: state.update?.version ?? null })),
}), {
  name: 'apiforge-updates-v1',
  partialize: (state) => ({ autoCheck: state.autoCheck, lastCheckedAt: state.lastCheckedAt }),
}));
