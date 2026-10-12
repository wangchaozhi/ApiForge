import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVersions, extractCargoLockVersion } from '../scripts/check-release-version.mjs';

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
    for (const folder of ['src-tauri', 'agent', 'crates/apiforge-engine']) await mkdir(join(dir, folder), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json',
      'agent/Cargo.toml', 'agent/Cargo.lock', 'crates/apiforge-engine/Cargo.toml']) {
      const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      await writeFile(join(dir, file), text.replace(/\r?\n/g, '\r\n'));
    }
    assert.equal(checkVersions(pathToFileURL(`${dir}/`)), checkVersions());
    const agentManifest = await readFile(join(dir, 'agent/Cargo.toml'), 'utf8');
    await writeFile(join(dir, 'agent/Cargo.toml'), agentManifest.replace(/^version = "[^"]+"/m, 'version = "999.0.0"'));
    assert.throws(() => checkVersions(pathToFileURL(`${dir}/`)), /Version mismatch/, 'agent version must follow the app');
    await writeFile(join(dir, 'agent/Cargo.toml'), agentManifest);
    await writeFile(join(dir, 'src-tauri/tauri.conf.json'), '{"version":"999.0.0"}');
    assert.throws(() => checkVersions(pathToFileURL(`${dir}/`)), /Version mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('handles CRLF Cargo.lock content', () => {
  assert.equal(extractCargoLockVersion('[[package]]\r\nname = "apiforge"\r\nversion = "0.5.0"\r\n'), '0.5.0');
  assert.equal(extractCargoLockVersion('[[package]]\nname = "apiforge-agent"\nversion = "0.5.0"\n'), undefined);
  assert.equal(extractCargoLockVersion('[[package]]\nname = "apiforge-agent"\nversion = "0.5.0"\n', 'apiforge-agent'), '0.5.0');
});
