import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { Stronghold, type Store } from '@tauri-apps/plugin-stronghold';
import type { EnvironmentProfile } from '../types/api';

const CLIENT_NAME = 'apiforge-secrets';
const SNAPSHOT_NAME = 'secrets.hold';

let activeStronghold: Stronghold | null = null;
let activeStore: Store | null = null;

function requireDesktopRuntime() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error('Secure secret storage requires the Tauri desktop runtime.');
  }
}

function requireStore() {
  if (!activeStore || !activeStronghold) throw new Error('Secret vault is locked.');
  return { stronghold: activeStronghold, store: activeStore };
}

export function isSecretVaultUnlocked() {
  return activeStore !== null && activeStronghold !== null;
}

export function environmentSecretKey(profileId: string, variableKey: string) {
  return `environment:${encodeURIComponent(profileId)}:${encodeURIComponent(variableKey)}`;
}

export async function unlockSecretVault(password: string) {
  requireDesktopRuntime();
  if (!password) throw new Error('Master password is required.');

  if (activeStronghold) {
    await activeStronghold.unload().catch(() => undefined);
    activeStronghold = null;
    activeStore = null;
  }

  const snapshotPath = await join(await appLocalDataDir(), SNAPSHOT_NAME);
  const stronghold = await Stronghold.load(snapshotPath, password);

  let client;
  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
    await stronghold.save();
  }

  activeStronghold = stronghold;
  activeStore = client.getStore();
}

export async function lockSecretVault() {
  const stronghold = activeStronghold;
  activeStore = null;
  activeStronghold = null;
  if (stronghold) await stronghold.unload();
}

export async function readSecret(key: string) {
  const { store } = requireStore();
  const bytes = await store.get(key);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export async function writeSecret(key: string, value: string) {
  const { store, stronghold } = requireStore();
  const bytes = Array.from(new TextEncoder().encode(value));
  await store.insert(key, bytes);
  await stronghold.save();
}

export async function deleteSecret(key: string) {
  const { store, stronghold } = requireStore();
  await store.remove(key);
  await stronghold.save();
}

export async function moveSecret(oldKey: string, newKey: string) {
  if (oldKey === newKey) return;
  const { store, stronghold } = requireStore();
  const value = await store.get(oldKey);
  if (value) await store.insert(newKey, Array.from(value));
  await store.remove(oldKey);
  await stronghold.save();
}

export async function loadEnvironmentSecrets(profiles: EnvironmentProfile[]) {
  const values: Array<{ profileId: string; key: string; value: string }> = [];
  for (const profile of profiles) {
    for (const [key, variable] of Object.entries(profile.variables)) {
      if (!variable.secret) continue;
      const value = await readSecret(environmentSecretKey(profile.id, key));
      values.push({ profileId: profile.id, key, value: value ?? '' });
    }
  }
  return values;
}
