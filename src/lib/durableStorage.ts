import type { StateStorage } from 'zustand/middleware';

const BACKUP_SUFFIX = '.backup';

function validJson(value: string | null) {
  if (!value) return false;
  try { JSON.parse(value); return true; } catch { return false; }
}

export const durableLocalStorage: StateStorage = {
  getItem(name) {
    const primary = localStorage.getItem(name);
    if (validJson(primary)) return primary;
    const backup = localStorage.getItem(`${name}${BACKUP_SUFFIX}`);
    return validJson(backup) ? backup : null;
  },
  setItem(name, value) {
    JSON.parse(value);
    const current = localStorage.getItem(name);
    if (validJson(current)) localStorage.setItem(`${name}${BACKUP_SUFFIX}`, current!);
    localStorage.setItem(name, value);
  },
  removeItem(name) {
    localStorage.removeItem(name);
    localStorage.removeItem(`${name}${BACKUP_SUFFIX}`);
  },
};
