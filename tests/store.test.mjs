import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from 'zustand/vanilla';
import { createAppState } from '../src/store/createAppState.ts';
import { workspacePersistence } from '../src/store/persistence.ts';

const makeStore = () => createStore(createAppState);

test('workspace actions preserve requests across folder/collection deletion and duplicate independently', () => {
  const store = makeStore();
  const state = () => store.getState();
  const collectionId = state().createCollection('API');
  const folderId = state().createFolder(collectionId, 'Users');
  state().createRequest({ collectionId, folderId });
  const originalId = state().activeRequestId;
  const copyId = state().duplicateRequest(originalId);
  assert.ok(copyId);
  assert.deepEqual(state().collections.at(-1).folders[0].requestIds, [originalId, copyId]);
  state().updateActiveRequest((request) => ({ ...request, params: [{ id: 'p', key: 'tag', value: 'copy', enabled: true }] }));
  assert.equal(state().requests.find((r) => r.id === originalId).params[0].key, '');
  state().deleteFolder(collectionId, folderId);
  assert.deepEqual(state().collections.at(-1).requestIds, [originalId, copyId]);
  state().deleteCollection(collectionId);
  assert.ok(state().requests.some((r) => r.id === originalId));
  assert.ok(state().requests.some((r) => r.id === copyId));
  state().deleteRequest(copyId);
  assert.equal(state().runtimeByRequest[copyId], undefined);
  assert.ok(!state().openRequestIds.includes(copyId));
});

test('runtime is isolated per request and closing a tab chooses an existing fallback', () => {
  const store = makeStore();
  const first = store.getState().activeRequestId;
  store.getState().createRequest();
  const second = store.getState().activeRequestId;
  store.getState().startRequest(first, 'op-first');
  store.getState().startRequest(second, 'op-second');
  const response = { status: 200, statusText: 'OK', headers: {}, body: '{}', elapsedMs: 1, sizeBytes: 2 };
  store.getState().completeRequest(first, response);
  assert.equal(store.getState().runtimeByRequest[second].sending, true);
  store.getState().failRequest(second, 'cancelled');
  assert.deepEqual(store.getState().runtimeByRequest[first].response, response);
  store.getState().closeRequest(second);
  assert.equal(store.getState().activeRequestId, first);
});

test('persistence restores legacy requests and removes dangling references without persisting runtime', () => {
  const current = makeStore().getState();
  const legacy = { ...current.requests[0] };
  delete legacy.auth;
  delete legacy.formFields;
  delete legacy.multipartFields;
  const saved = {
    requests: [legacy], collections: [{ id: 'c', name: 'Legacy', requestIds: [legacy.id, 'missing'] }],
    openRequestIds: ['missing'], activeRequestId: legacy.id,
    networkSettings: { timeoutMs: 9000 }, environments: { token: 'value' },
  };
  const restored = workspacePersistence.merge(saved, current);
  assert.deepEqual(restored.openRequestIds, [legacy.id]);
  assert.deepEqual(restored.collections[0].requestIds, [legacy.id]);
  assert.deepEqual(restored.collections[0].folders, []);
  assert.equal(restored.networkSettings.timeoutMs, 9000);
  assert.equal(restored.networkSettings.verifyTls, true);
  assert.deepEqual(restored.requests[0].auth, { type: 'none' });
  assert.equal(restored.requests[0].multipartFields.length, 1);
  const serialized = workspacePersistence.partialize(restored);
  assert.equal(serialized.runtimeByRequest, undefined);
  assert.equal(serialized.history, undefined);
  const roundtrip = workspacePersistence.merge(JSON.parse(JSON.stringify(serialized)), makeStore().getState());
  assert.deepEqual(roundtrip.requests, restored.requests);
  assert.deepEqual(roundtrip.environments, saved.environments);
});

test('independent stores do not share starter identities', () => {
  assert.notEqual(makeStore().getState().activeRequestId, makeStore().getState().activeRequestId);
});
