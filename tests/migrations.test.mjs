import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateWorkspaceSnapshot } from '../src/lib/migrations.ts';

test('migrates legacy environment maps to the v1 workspace schema', () => {
  const migrated = migrateWorkspaceSnapshot({
    schema: 'apiforge.workspace',
    schemaVersion: 0,
    data: { requests: [], collections: [], environments: { api: 'https://example.test' } },
  });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.data.environmentProfiles[0].variables.api.value, 'https://example.test');
  assert.equal(migrated.data.environmentProfiles[0].variables.api.secret, false);
  assert.equal('environments' in migrated.data, false);
});

test('rejects future workspace schemas instead of silently downgrading', () => {
  assert.throws(
    () => migrateWorkspaceSnapshot({ schema: 'apiforge.workspace', schemaVersion: 99, data: {} }),
    /newer than this ApiForge version/,
  );
});
