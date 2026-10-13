import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archLabel, collectArtifacts } from '../scripts/collect-artifacts.mjs';
import { createUpdateManifest } from '../scripts/create-update-manifest.mjs';

const payload = (name) => Buffer.alloc(8192, name);

async function write(root, files) {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents ?? payload(path));
  }
}

// Bundle layouts as produced by `tauri build` with createUpdaterArtifacts on each runner.
const layouts = {
  'linux-x64': {
    target: 'x86_64-unknown-linux-gnu', bundles: ['deb', 'rpm', 'appimage'],
    files: {
      'deb/ApiForge_1.0.0_amd64.deb': null, 'deb/ApiForge_1.0.0_amd64.deb.sig': 'sig-deb',
      'deb/ApiForge_1.0.0_amd64/control.tar.gz': null, 'deb/ApiForge_1.0.0_amd64/data.tar.gz': null,
      'rpm/ApiForge-1.0.0-1.x86_64.rpm': null, 'rpm/ApiForge-1.0.0-1.x86_64.rpm.sig': 'sig-rpm',
      'appimage/ApiForge_1.0.0_amd64.AppImage': null, 'appimage/ApiForge_1.0.0_amd64.AppImage.sig': 'sig-linux',
    },
  },
  'windows-x64': {
    target: 'x86_64-pc-windows-msvc', bundles: ['nsis', 'msi'],
    files: {
      'nsis/ApiForge_1.0.0_x64-setup.exe': null, 'nsis/ApiForge_1.0.0_x64-setup.exe.sig': 'sig-windows',
      'msi/ApiForge_1.0.0_x64_en-US.msi': null, 'msi/ApiForge_1.0.0_x64_en-US.msi.sig': 'sig-msi',
      'portable/ApiForge_1.0.0_x64-portable.zip': null,
    },
  },
  'macos-arm64': {
    target: 'aarch64-apple-darwin', bundles: ['app', 'dmg'],
    files: {
      'dmg/ApiForge_1.0.0_aarch64.dmg': null,
      'macos/ApiForge.app/Contents/MacOS/apiforge': null,
      'macos/ApiForge.app.tar.gz': payload('arm'), 'macos/ApiForge.app.tar.gz.sig': 'sig-arm',
    },
  },
  'macos-x64': {
    target: 'x86_64-apple-darwin', bundles: ['app', 'dmg'],
    files: {
      'dmg/ApiForge_1.0.0_x64.dmg': null,
      'macos/ApiForge.app/Contents/MacOS/apiforge': null,
      'macos/ApiForge.app.tar.gz': payload('intel'), 'macos/ApiForge.app.tar.gz.sig': 'sig-intel',
    },
  },
};

test('architecture labels match installer naming', () => {
  assert.equal(archLabel('aarch64-apple-darwin'), 'aarch64');
  assert.equal(archLabel('x86_64-apple-darwin'), 'x64');
});

test('collected release artifacts pass smoke checks and produce a complete update manifest', async () => {
  const work = await mkdtemp(join(tmpdir(), 'apiforge-release-'));
  try {
    // Each runner uploads its own directory; publish merges them into one.
    const merged = join(work, 'release-artifacts');
    for (const [platform, layout] of Object.entries(layouts)) {
      const bundleRoot = join(work, platform, 'bundle');
      await write(bundleRoot, layout.files);
      const outDir = join(work, platform, 'out');
      await collectArtifacts({ bundleRoot, outDir, target: layout.target, platform, bundles: layout.bundles, version: '1.0.0' });
      for (const name of await readdir(outDir)) {
        await mkdir(merged, { recursive: true });
        await writeFile(join(merged, name), await readFile(join(outDir, name)), { flag: 'wx' });
      }
    }

    const names = (await readdir(merged)).sort();
    assert.ok(!names.includes('control.tar.gz') && !names.includes('data.tar.gz'), 'bundler intermediates are skipped');
    assert.ok(names.includes('ApiForge_1.0.0_aarch64.app.tar.gz') && names.includes('ApiForge_1.0.0_x64.app.tar.gz.sig'));
    assert.ok(names.includes('ApiForge_1.0.0_x64-portable.zip'), 'portable zip is collected');

    execFileSync(process.execPath, ['scripts/smoke-artifacts.mjs', merged], { stdio: 'pipe' });

    const manifest = await createUpdateManifest(merged, 'v1.0.0', 'https://example.test/download', new Date(0));
    assert.deepEqual(manifest.platforms, {
      'darwin-aarch64': { signature: 'sig-arm', url: 'https://example.test/download/ApiForge_1.0.0_aarch64.app.tar.gz' },
      'darwin-x86_64': { signature: 'sig-intel', url: 'https://example.test/download/ApiForge_1.0.0_x64.app.tar.gz' },
      'linux-x86_64': { signature: 'sig-linux', url: 'https://example.test/download/ApiForge_1.0.0_amd64.AppImage' },
      'windows-x86_64': { signature: 'sig-windows', url: 'https://example.test/download/ApiForge_1.0.0_x64-setup.exe' },
    });
    for (const { url } of Object.values(manifest.platforms)) {
      assert.ok(names.includes(decodeURIComponent(url.split('/').pop())), `${url} is uploaded`);
    }
    assert.equal(JSON.parse(await readFile(join(merged, 'latest.json'), 'utf8')).version, '1.0.0');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('missing installers and signatures fail loudly', async () => {
  const work = await mkdtemp(join(tmpdir(), 'apiforge-release-'));
  try {
    await write(join(work, 'bundle'), { 'nsis/ApiForge_1.0.0_x64-setup.exe': null });
    await assert.rejects(
      collectArtifacts({ bundleRoot: join(work, 'bundle'), outDir: join(work, 'out'), target: 'x86_64-pc-windows-msvc', platform: 'windows-x64', bundles: ['nsis', 'msi'], version: '1.0.0' }),
      /Missing msi installer/,
    );
    await write(work, { 'only/ApiForge_1.0.0_amd64.AppImage.sig': 'x' });
    await assert.rejects(createUpdateManifest(join(work, 'only'), 'v1.0.0', 'https://example.test'), /Missing updater signature for darwin-aarch64/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('release config wires updater key and platform signing', async () => {
  const { releaseConfig } = await import('../scripts/write-release-config.mjs');
  const pubkey = 'dW50cnVzdGVk';
  assert.throws(() => releaseConfig({ os: 'Linux' }), /TAURI_UPDATER_PUBKEY/);
  assert.deepEqual(releaseConfig({ updaterPubkey: pubkey, os: 'Linux' }), {
    bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey } },
  });
  assert.deepEqual(releaseConfig({ updaterPubkey: pubkey, os: 'Windows', windowsThumbprint: 'ABC123' }).bundle.windows, {
    certificateThumbprint: 'ABC123', digestAlgorithm: 'sha256', timestampUrl: 'http://timestamp.digicert.com',
  });
  assert.equal(releaseConfig({ updaterPubkey: pubkey, os: 'Windows' }).bundle.windows, undefined);
  assert.deepEqual(releaseConfig({ updaterPubkey: pubkey, os: 'macOS' }).bundle.macOS, { signingIdentity: '-' });
  assert.equal(releaseConfig({ updaterPubkey: pubkey, os: 'macOS', appleCertificate: 'cert' }).bundle.macOS, undefined);
});

test('update notes come from the matching changelog section', async () => {
  const { changelogNotes } = await import('../scripts/create-update-manifest.mjs');
  const changelog = '## 1.0.1\r\n\r\n- New thing\r\n- Fix\r\n\r\n## 1.0.0\n\n- Old\n';
  assert.equal(changelogNotes(changelog, '1.0.1'), '- New thing\n- Fix');
  assert.equal(changelogNotes(changelog, '1.0.0'), '- Old');
  assert.equal(changelogNotes(changelog, '2.0.0'), null);
  const real = await readFile('CHANGELOG.md', 'utf8');
  assert.match(changelogNotes(real, '1.0.1'), /Automatic updates/);
});
