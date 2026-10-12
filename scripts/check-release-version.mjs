import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function extractCargoLockVersion(lockText, name = 'apiforge') {
  const normalized = lockText.replace(/\r\n/g, '\n');
  return normalized.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`))?.[1];
}

const manifestVersion = (text) => text.match(/^version = "([^"]+)"/m)?.[1];

export function checkVersions(root = new URL('../', import.meta.url), tag = '') {
  const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const version = json('package.json').version;
  const text = (path) => readFileSync(new URL(path, root), 'utf8');
  const lock = text('src-tauri/Cargo.lock');
  const agentLock = text('agent/Cargo.lock');
  const versions = [
    json('src-tauri/tauri.conf.json').version,
    json('package-lock.json').version,
    json('package-lock.json').packages[''].version,
    manifestVersion(text('src-tauri/Cargo.toml')),
    extractCargoLockVersion(lock),
    manifestVersion(text('crates/apiforge-engine/Cargo.toml')),
    extractCargoLockVersion(lock, 'apiforge-engine'),
    manifestVersion(text('agent/Cargo.toml')),
    extractCargoLockVersion(agentLock, 'apiforge-agent'),
    extractCargoLockVersion(agentLock, 'apiforge-engine'),
  ];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || versions.some((value) => value !== version)) {
    throw new Error(`Version mismatch: package=${version}, manifests/locks=${versions.join(', ')}`);
  }
  if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} must match v${version}`);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Release version verified: ${checkVersions(undefined, process.env.RELEASE_TAG)}`);
}
