import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVersions } from '../scripts/check-release-version.mjs';

test('release manifests and lockfiles agree', () => {
  const version = checkVersions();
  assert.equal(checkVersions(undefined, `v${version}`), version);
  assert.throws(() => checkVersions(undefined, 'v999.0.0'), /must match/);
});

test('version validation accepts Windows CRLF checkouts', async () => {
  const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'apiforge-version-'));
  try {
    await mkdir(join(dir, 'src-tauri'));
    for (const file of ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json']) {
      const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      await writeFile(join(dir, file), text.replace(/\r?\n/g, '\r\n'));
    }
    assert.equal(checkVersions(pathToFileURL(`${dir}/`)), checkVersions());
    await writeFile(join(dir, 'src-tauri/tauri.conf.json'), '{"version":"999.0.0"}');
    assert.throws(() => checkVersions(pathToFileURL(`${dir}/`)), /Version mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
