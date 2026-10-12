import test from 'node:test';
import assert from 'node:assert/strict';
import { grpcCallKind, isValidBase64, validateOutgoing } from '../src/services/protocols.ts';
import { zhCN } from '../src/i18n/messages.ts';

test('binary WebSocket payloads must be Base64', () => {
  assert.ok(isValidBase64('AAEC'));
  assert.ok(isValidBase64('AA EC\nAw=='));
  assert.ok(isValidBase64('AAECAw'));
  assert.ok(!isValidBase64(''));
  assert.ok(!isValidBase64('A'));
  assert.ok(!isValidBase64('not base64!'));
  assert.ok(!isValidBase64('AA=C'));
});

test('outgoing WebSocket frames are validated before sending', () => {
  assert.equal(validateOutgoing('text', 'hello'), null);
  assert.equal(validateOutgoing('text', ''), 'Message payload is empty.');
  assert.equal(validateOutgoing('binary', '%%'), 'Binary payload must be valid Base64.');
  assert.equal(validateOutgoing('ping', ''), null);
  assert.equal(validateOutgoing('ping', 'é'.repeat(63)), 'Ping payload must be at most 125 bytes.');
  for (const key of ['Message payload is empty.', 'Binary payload must be valid Base64.', 'Ping payload must be at most 125 bytes.']) {
    assert.ok(Object.hasOwn(zhCN, key), key);
  }
});

test('gRPC call kinds follow the streaming flags', () => {
  assert.equal(grpcCallKind({ clientStreaming: false, serverStreaming: false }), 'unary');
  assert.equal(grpcCallKind({ clientStreaming: false, serverStreaming: true }), 'serverStreaming');
  assert.equal(grpcCallKind({ clientStreaming: true, serverStreaming: false }), 'clientStreaming');
  assert.equal(grpcCallKind({ clientStreaming: true, serverStreaming: true }), 'bidiStreaming');
});
