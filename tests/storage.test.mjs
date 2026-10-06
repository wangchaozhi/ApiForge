import test from 'node:test';
import assert from 'node:assert/strict';
import { durableLocalStorage } from '../src/platform/durableStorage.ts';
import { parseWorkspace, serializeWorkspace } from '../src/services/workspace/transfer.ts';
import { createAppState } from '../src/store/createAppState.ts';
import { createStore } from 'zustand/vanilla';

test('durable storage recovers the previous snapshot when the primary is corrupted', (t) => {
  const values = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  durableLocalStorage.setItem('workspace', '{"revision":1}');
  durableLocalStorage.setItem('workspace', '{"revision":2}');
  assert.equal(JSON.parse(durableLocalStorage.getItem('workspace')).revision, 2);
  values.set('workspace', '{corrupted');
  assert.equal(JSON.parse(durableLocalStorage.getItem('workspace')).revision, 1);
  assert.throws(() => durableLocalStorage.setItem('workspace', '{invalid'));
  durableLocalStorage.removeItem('workspace');
  assert.equal(durableLocalStorage.getItem('workspace'), null);
  assert.equal(values.has('workspace.backup'), false);
});

test('workspace transfer retains modular state and migrates legacy environment maps', () => {
  const state = createStore(createAppState).getState();
  const exported = serializeWorkspace(state);
  const restored = parseWorkspace(exported);
  assert.equal(restored.data.requests[0].url, state.requests[0].url);
  assert.equal(restored.data.environmentProfiles[0].variables.name.value, 'ApiForge');
  const legacy = JSON.parse(exported);
  legacy.schemaVersion = 0;
  delete legacy.data.environmentProfiles;
  delete legacy.data.activeEnvironmentId;
  legacy.data.environments = { endpoint: 'http://localhost' };
  assert.equal(parseWorkspace(JSON.stringify(legacy)).data.environmentProfiles[0].variables.endpoint.value, 'http://localhost');
});
