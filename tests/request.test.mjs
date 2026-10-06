import test from 'node:test';
import assert from 'node:assert/strict';
import { toEngineRequest } from '../src/lib/request.ts';

export const network = { timeoutMs: 30000, followRedirects: true, verifyTls: true, cookiesEnabled: true, useSystemProxy: true, proxyUrl: '' };
const field = (key, value, enabled = true) => ({ id: key, key, value, enabled });
const request = (overrides = {}) => ({
  id: 'request', name: 'Test', method: 'GET', url: 'https://example.com/?tag=original',
  params: [], headers: [], bodyType: 'none', body: '', formFields: [], multipartFields: [], auth: { type: 'none' }, ...overrides,
});

test('query parameters preserve repeated values, URL values, and order', () => {
  const result = toEngineRequest(request({ params: [field('tag', 'one'), field('{{key}}', '{{value}}'), field('tag', 'ignored', false), field('', 'ignored')] }), { key: 'tag', value: 'two & three' }, network);
  assert.deepEqual([...new URL(result.url).searchParams], [['tag', 'original'], ['tag', 'one'], ['tag', 'two & three']]);
});

test('query API key replaces conflicting values without losing other repeated parameters', () => {
  const result = toEngineRequest(request({ url: 'https://example.com/?token=old', params: [field('tag', 'one'), field('tag', 'two'), field('token', 'stale')], auth: { type: 'apiKey', addTo: 'query', key: '{{key}}', value: '{{token}}' } }), { key: 'token', token: 'secret' }, network);
  const params = new URL(result.url).searchParams;
  assert.deepEqual(params.getAll('token'), ['secret']);
  assert.deepEqual(params.getAll('tag'), ['one', 'two']);
});
