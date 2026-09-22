import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVersions } from '../scripts/check-release-version.mjs';

test('release manifests and lockfiles agree', () => {
  const version = checkVersions();
  assert.equal(checkVersions(undefined, `v${version}`), version);
  assert.throws(() => checkVersions(undefined, 'v999.0.0'), /must match/);
});
