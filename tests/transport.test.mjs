import test from 'node:test';
import assert from 'node:assert/strict';
import { sendApiRequest, cancelApiRequest } from '../src/services/http/transport.ts';

const request = (overrides = {}) => ({
  method: 'POST', url: 'https://example.com/', headers: {},
  body: { type: 'urlencoded', fields: [{ key: 'tag', value: 'one' }, { key: 'tag', value: 'two' }] },
  network: { timeoutMs: 30000, followRedirects: true, cookiesEnabled: false }, ...overrides,
});
function browser(t) {
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
}

test('browser transport sends repeated form fields and returns text metadata', async (t) => {
  browser(t);
  let options;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    options = init;
    return new Response('{"ok":true}', { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/json' } });
  });
  const response = await sendApiRequest(request(), 'text-test');
  assert.equal(options.body.toString(), 'tag=one&tag=two');
  assert.equal(options.credentials, 'omit');
  assert.equal(response.status, 201);
  assert.equal(response.bodyEncoding, 'utf8');
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(response.sizeBytes, 11);
  await cancelApiRequest('text-test');
  assert.equal(options.signal.aborted, false, 'completed request controller should be removed');
});

test('browser transport preserves binary bytes and omits GET bodies', async (t) => {
  browser(t);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.body, undefined);
    return new Response(new Uint8Array([0, 255, 128, 1]), { headers: { 'Content-Type': 'image/png' } });
  });
  const response = await sendApiRequest(request({ method: 'GET' }), 'binary-test');
  assert.equal(response.bodyEncoding, 'base64');
  assert.equal(response.sizeBytes, 4);
  assert.deepEqual([...Buffer.from(response.body, 'base64')], [0, 255, 128, 1]);
});

test('cancellation targets the active browser operation and rejects its promise', async (t) => {
  browser(t);
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, init) => {
    signal = init.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  const pending = sendApiRequest(request(), 'cancel-test');
  await cancelApiRequest('other-operation');
  assert.equal(signal.aborted, false);
  const rejected = assert.rejects(pending, /cancelled|已取消/i);
  await cancelApiRequest('cancel-test');
  await rejected;
  assert.equal(signal.aborted, true);
});
