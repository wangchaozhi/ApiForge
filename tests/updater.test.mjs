import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_INTERVAL_MS, isCheckDue, progressPercent } from '../src/services/updater.ts';
import { zhCN } from '../src/i18n/messages.ts';

test('background update checks are due once per interval', () => {
  const now = 1_000_000_000;
  assert.equal(isCheckDue(null, now), true);
  assert.equal(isCheckDue(now - CHECK_INTERVAL_MS + 1, now), false);
  assert.equal(isCheckDue(now - CHECK_INTERVAL_MS, now), true);
  assert.equal(isCheckDue(now - 1000, now, 500), true);
});

test('download progress is reported as a bounded percentage', () => {
  assert.equal(progressPercent(null), null);
  assert.equal(progressPercent({ downloaded: 10 }), null);
  assert.equal(progressPercent({ downloaded: 0, total: 0 }), null);
  assert.equal(progressPercent({ downloaded: 512, total: 1024 }), 50);
  assert.equal(progressPercent({ downloaded: 2048, total: 1024 }), 100);
});

test('update messages are translated', () => {
  for (const key of ['ApiForge {version} is available', 'Update now', 'Later', 'Check for updates automatically', 'Update failed: {message}']) {
    assert.ok(Object.hasOwn(zhCN, key), key);
  }
});
