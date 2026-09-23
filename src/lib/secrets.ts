import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { Stronghold, type Store } from '@tauri-apps/plugin-stronghold';
import type { AuthConfig, EnvironmentProfile, NetworkSettings } from '../types/api';

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

type AuthSecretField = 'token' | 'password' | 'value' | 'clientSecret' | 'accessToken' | 'refreshToken';
type NetworkSecretField = 'proxyPassword' | 'clientCertificatePassword';

function requestSecretKey(requestId: string, field: AuthSecretField) {
  return `request:${encodeURIComponent(requestId)}:${field}`;
}

function networkSecretKey(field: NetworkSecretField) {
  return `network:${field}`;
}

async function replaceSecret(key: string, value: string) {
  if (value) await writeSecret(key, value);
  else await deleteSecret(key);
}

export async function saveAuthSecrets(requestId: string, auth: AuthConfig) {
  if (!isSecretVaultUnlocked()) return;
  if (auth.type === 'bearer') await replaceSecret(requestSecretKey(requestId, 'token'), auth.token);
  if (auth.type === 'basic' || auth.type === 'digest') await replaceSecret(requestSecretKey(requestId, 'password'), auth.password);
  if (auth.type === 'apiKey') await replaceSecret(requestSecretKey(requestId, 'value'), auth.value);
  if (auth.type === 'oauth2') {
    await replaceSecret(requestSecretKey(requestId, 'clientSecret'), auth.clientSecret);
    await replaceSecret(requestSecretKey(requestId, 'accessToken'), auth.accessToken);
    await replaceSecret(requestSecretKey(requestId, 'refreshToken'), auth.refreshToken);
  }
}

export async function loadAuthSecrets(requestId: string, auth: AuthConfig): Promise<AuthConfig> {
  if (!isSecretVaultUnlocked()) return auth;
  if (auth.type === 'bearer') return { ...auth, token: (await readSecret(requestSecretKey(requestId, 'token'))) ?? '' };
  if (auth.type === 'basic' || auth.type === 'digest') return { ...auth, password: (await readSecret(requestSecretKey(requestId, 'password'))) ?? '' };
  if (auth.type === 'apiKey') return { ...auth, value: (await readSecret(requestSecretKey(requestId, 'value'))) ?? '' };
  if (auth.type === 'oauth2') return {
    ...auth,
    clientSecret: (await readSecret(requestSecretKey(requestId, 'clientSecret'))) ?? '',
    accessToken: (await readSecret(requestSecretKey(requestId, 'accessToken'))) ?? '',
    refreshToken: (await readSecret(requestSecretKey(requestId, 'refreshToken'))) ?? '',
  };
  return auth;
}

export async function saveNetworkSecret(field: NetworkSecretField, value: string) {
  if (!isSecretVaultUnlocked()) return;
  await replaceSecret(networkSecretKey(field), value);
}

export async function loadNetworkSecrets(): Promise<Partial<NetworkSettings>> {
  if (!isSecretVaultUnlocked()) return {};
  return {
    proxyPassword: (await readSecret(networkSecretKey('proxyPassword'))) ?? '',
    clientCertificatePassword: (await readSecret(networkSecretKey('clientCertificatePassword'))) ?? '',
  };
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
