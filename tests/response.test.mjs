import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, headerValue, responseLanguage, prettyBody, countMatches } from '../src/features/response/format.ts';

test('response helpers preserve header lookup, JSON formatting and raw fallback', () => {
  assert.equal(headerValue({ 'Content-Type': 'application/json' }, 'content-type'), 'application/json');
  assert.equal(responseLanguage('application/problem+json', '{}'), 'json');
  assert.equal(responseLanguage('', '{"ok":true}'), 'json');
  assert.equal(prettyBody('{"ok":true}', 'json'), '{\n  "ok": true\n}');
  assert.equal(prettyBody('{invalid}', 'json'), '{invalid}');
  assert.equal(formatBytes(1024), '1.0 KB');
});

test('response search is case insensitive with nonoverlapping matches', () => {
  assert.equal(countMatches('Test test TEST', 'test'), 3);
  assert.equal(countMatches('aaaa', 'aa'), 2);
  assert.equal(countMatches('text', ''), 0);
  assert.equal(countMatches('', 'text'), 0);
});
