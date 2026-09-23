import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVersions, extractCargoLockVersion } from '../scripts/check-release-version.mjs';

test('release manifests and lockfiles agree', () => {
  const version = checkVersions();
  assert.equal(checkVersions(undefined, `v${version}`), version);
  assert.throws(() => checkVersions(undefined, 'v999.0.0'), /must match/);
});


test('handles CRLF Cargo.lock content', () => {
  const lock = '[[package]]\r\nname = "apiforge"\r\nversion = "0.5.0"\r\ndependencies = []\r\n';
  assert.equal(extractCargoLockVersion(lock), '0.5.0');
});
