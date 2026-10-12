import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSseParserState, flushSse, isSseResponseOk, MAX_SSE_BACKOFF_MS, parseSseBlock, planSseReconnect, pushSseChunk,
} from '../src/services/sse.ts';
import { zhCN } from '../src/i18n/messages.ts';

const policy = (overrides = {}) => ({ autoReconnect: true, stopped: false, retryMs: 1000, failures: 0, ...overrides });

test('SSE parser handles fields, comments, CRLF and chunk boundaries', () => {
  assert.deepEqual(parseSseBlock('event: tick\nid: 7\nretry: 2500\ndata: a\ndata: b'), { event: 'tick', data: 'a\nb', id: '7', retry: 2500 });
  assert.equal(parseSseBlock(': comment only'), null);
  assert.equal(parseSseBlock('data:no-space').data, 'no-space');
  assert.equal(parseSseBlock('data: x\nretry: soon').retry, undefined);
  assert.equal(parseSseBlock('data: x\nid: a\0b').id, undefined);

  const state = createSseParserState();
  assert.deepEqual(pushSseChunk(state, 'data: hel'), []);
  assert.deepEqual(pushSseChunk(state, 'lo\r\n\r\ndata: second\n').map((event) => event.data), ['hello']);
  assert.deepEqual(pushSseChunk(state, '\nevent: x\ndata: third'), [{ event: 'message', data: 'second', id: undefined, retry: undefined }]);
  assert.deepEqual(flushSse(state), { event: 'x', data: 'third', id: undefined, retry: undefined });
  assert.equal(flushSse(state), null);
});

test('successful streams reconnect after the retry delay', () => {
  assert.deepEqual(planSseReconnect({ status: 200, contentType: 'text/event-stream; charset=utf-8' }, policy()), { reconnect: true, delayMs: 1000 });
  assert.deepEqual(planSseReconnect({}, policy({ retryMs: 20 })), { reconnect: true, delayMs: 100 });
});

test('repeated failures back off exponentially up to the cap', () => {
  assert.equal(planSseReconnect({}, policy({ failures: 1 })).delayMs, 2000);
  assert.equal(planSseReconnect({}, policy({ failures: 3 })).delayMs, 8000);
  assert.equal(planSseReconnect({}, policy({ failures: 50 })).delayMs, MAX_SSE_BACKOFF_MS);
  assert.equal(planSseReconnect({}, policy({ retryMs: 45_000, failures: 2 })).delayMs, 45_000);
});

test('fatal responses and user intent stop reconnecting', () => {
  assert.deepEqual(planSseReconnect({ status: 204 }, policy()), { reconnect: false, reason: 'noContent' });
  assert.deepEqual(planSseReconnect({ status: 404, contentType: 'text/html' }, policy()), { reconnect: false, reason: 'httpStatus' });
  assert.deepEqual(planSseReconnect({ status: 503 }, policy()), { reconnect: false, reason: 'httpStatus' });
  assert.deepEqual(planSseReconnect({ status: 200, contentType: 'application/json' }, policy()), { reconnect: false, reason: 'contentType' });
  assert.deepEqual(planSseReconnect({ status: 200, contentType: 'text/event-stream' }, policy({ stopped: true })), { reconnect: false });
  assert.deepEqual(planSseReconnect({ status: 200, contentType: 'text/event-stream' }, policy({ autoReconnect: false })), { reconnect: false });
  assert.equal(isSseResponseOk({ status: 200, contentType: 'TEXT/EVENT-STREAM' }), true);
  assert.equal(isSseResponseOk({ status: 200, contentType: '' }), false);
  for (const key of ['The server returned 204 No Content; not reconnecting.', 'The server returned HTTP {status}; not reconnecting.', 'The response is not text/event-stream ({type}); not reconnecting.']) {
    assert.ok(Object.hasOwn(zhCN, key), key);
  }
});
