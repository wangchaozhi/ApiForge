import test from 'node:test';
import assert from 'node:assert/strict';
import { sendApiRequest, cancelApiRequest, currentRequestEngine } from '../src/services/http/transport.ts';
import { fetchAgentInfo, probeAgent } from '../src/services/http/agent.ts';
import { activeAgentConnection, normalizeAgentConnection, useAgentConnectionStore } from '../src/platform/agentConnection.ts';
import { useLanguageStore } from '../src/i18n/index.ts';

const request = (overrides = {}) => ({
  method: 'POST', url: 'http://localhost:3000/items', headers: { 'X-Test': '1' },
  body: { type: 'text', content: '{"name":"forge"}' },
  network: { timeoutMs: 30000, followRedirects: true, cookiesEnabled: false },
  digestAuth: { username: 'user', password: 'pass' }, ...overrides,
});

function browser(t, connection) {
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  useAgentConnectionStore.setState({ connection: normalizeAgentConnection(connection) });
  t.after(() => {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    useAgentConnectionStore.setState({ connection: normalizeAgentConnection({}) });
  });
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('agent connections are normalized and only active when complete', (t) => {
  assert.deepEqual(normalizeAgentConnection({ enabled: true, url: ' http://127.0.0.1:47811/ ', token: ' abc ' }),
    { enabled: true, url: 'http://127.0.0.1:47811', token: 'abc' });
  assert.deepEqual(normalizeAgentConnection(null), { enabled: false, url: 'http://127.0.0.1:47811', token: '' });

  browser(t, { enabled: true, url: 'http://127.0.0.1:47811', token: '' });
  assert.equal(activeAgentConnection(), null, 'a connection without a token is inactive');
  assert.equal(currentRequestEngine(), 'browser');
  useAgentConnectionStore.getState().updateConnection({ token: 'secret-token' });
  assert.equal(currentRequestEngine(), 'agent');
  useAgentConnectionStore.getState().updateConnection({ enabled: false });
  assert.equal(currentRequestEngine(), 'browser');
});

test('enabled agent receives the engine request with the bearer token', async (t) => {
  browser(t, { enabled: true, url: 'http://127.0.0.1:47811/', token: 'secret-token' });
  let call;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    call = { url, init };
    return json({ status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' }, body: '{"id":1}', bodyEncoding: 'utf8', elapsedMs: 12, sizeBytes: 8 });
  });
  const response = await sendApiRequest(request(), 'op-agent');
  assert.equal(call.url, 'http://127.0.0.1:47811/v1/http/send');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.headers.get('Authorization'), 'Bearer secret-token');
  const sent = JSON.parse(call.init.body);
  assert.equal(sent.operationId, 'op-agent');
  assert.equal(sent.request.url, 'http://localhost:3000/items');
  assert.deepEqual(sent.request.digestAuth, { username: 'user', password: 'pass' }, 'digest auth is delegated to the agent');
  assert.equal(response.status, 201);
  assert.equal(response.body, '{"id":1}');
});

test('agent errors become readable messages', async (t) => {
  browser(t, { enabled: true, url: 'http://127.0.0.1:47811', token: 'secret-token' });
  const replies = [
    () => json({ error: 'missing or invalid agent token', kind: 'unauthorized' }, 401),
    () => json({ error: 'blocked by execution policy: 127.0.0.1 is not a public address', kind: 'policy' }, 403),
    () => new Response('<html>Bad gateway</html>', { status: 502 }),
    () => { throw new TypeError('Failed to fetch'); },
  ];
  t.mock.method(globalThis, 'fetch', async () => replies.shift()());
  await assert.rejects(sendApiRequest(request(), 'e1'), /rejected the token|拒绝/);
  await assert.rejects(sendApiRequest(request(), 'e2'), (error) => error.kind === 'policy' && /^(Blocked by the request agent|请求代理拒绝了该请求)/.test(error.message) && error.message.endsWith('127.0.0.1 is not a public address'));
  await assert.rejects(sendApiRequest(request(), 'e3'), /\(502\)|（502）/);
  await assert.rejects(sendApiRequest(request(), 'e4'), (error) => error.kind === 'unreachable' && error.message.includes('http://127.0.0.1:47811'));
});

test('cancelling asks the agent to stop and rejects the pending request', async (t) => {
  browser(t, { enabled: true, url: 'http://127.0.0.1:47811', token: 'secret-token' });
  const calls = [];
  t.mock.method(globalThis, 'fetch', (url, init) => {
    calls.push(url);
    if (url.endsWith('/v1/http/cancel')) {
      assert.deepEqual(JSON.parse(init.body), { operationId: 'slow' });
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  });
  const pending = sendApiRequest(request(), 'slow');
  await cancelApiRequest('slow');
  await assert.rejects(pending, /cancelled|已取消/i);
  assert.deepEqual(calls, ['http://127.0.0.1:47811/v1/http/send', 'http://127.0.0.1:47811/v1/http/cancel']);
  await cancelApiRequest('unknown-operation');
  assert.equal(calls.length, 2, 'unknown operations do not reach the agent');
});

test('agent info and health probe', async (t) => {
  browser(t, {});
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/v1/health')
    ? json({ status: 'ok', name: url.startsWith('http://agent') ? 'apiforge-agent' : 'something-else' })
    : json({ name: 'apiforge-agent', version: '1.0.0', mode: 'relay', capabilities: { localFiles: false, proxies: false, privateNetworks: false, cookieJar: false, maxResponseBytes: 1024 } }));
  assert.equal(await probeAgent('http://agent.example'), true);
  assert.equal(await probeAgent('http://other.example'), false);
  const info = await fetchAgentInfo({ enabled: true, url: 'http://agent.example', token: 'secret-token' });
  assert.equal(info.mode, 'relay');
  assert.equal(info.capabilities.maxResponseBytes, 1024);
});

test('browser fetch failures explain the likely CORS cause', async (t) => {
  // The assertion checks the English message; do not depend on the machine's locale.
  const preference = useLanguageStore.getState().preference;
  useLanguageStore.getState().setPreference('en');
  t.after(() => useLanguageStore.getState().setPreference(preference));
  browser(t, { enabled: false });
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(sendApiRequest(request({ digestAuth: undefined }), 'cors'), (error) =>
    error.message.startsWith('Failed to fetch.') && /CORS/.test(error.message));
});
