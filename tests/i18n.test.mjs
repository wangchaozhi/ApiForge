import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, translateMessage } from '../src/i18n/core.ts';
import { zhCN } from '../src/i18n/messages.ts';

test('system language detection and explicit overrides', () => {
  assert.equal(resolveLocale('system', 'zh-TW'), 'zh-CN');
  assert.equal(resolveLocale('system', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLocale('system', 'fr-FR'), 'en');
  assert.equal(resolveLocale('en', 'zh-CN'), 'en');
  assert.equal(resolveLocale('zh-CN', 'en-US'), 'zh-CN');
});

test('translations preserve placeholders and user-supplied text', () => {
  assert.equal(translateMessage('en', 'Send'), 'Send');
  assert.equal(translateMessage('zh-CN', 'Send'), '发送');
  assert.equal(translateMessage('zh-CN', 'Close {name}', { name: '<test> $& {name}' }), '关闭 <test> $& {name}');
  assert.equal(translateMessage('zh-CN', '{{token}} or paste a bearer token', { token: 'secret' }), '{{token}} 或粘贴 Bearer 令牌');
  assert.equal(translateMessage('en', 'Close {name}'), 'Close {name}');
});

test('all Chinese messages retain the English interpolation parameters', () => {
  const parameters = (value) => [...value.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((match) => match[1]).sort();
  for (const [key, translation] of Object.entries(zhCN)) {
    assert.ok(translation.trim(), key);
    assert.deepEqual(parameters(translation), parameters(key), key);
  }
});
