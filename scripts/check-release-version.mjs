import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkVersions(root = new URL('../', import.meta.url), tag = '') {
  const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const version = json('package.json').version;
  const cargo = readFileSync(new URL('src-tauri/Cargo.toml', root), 'utf8');
  const lock = readFileSync(new URL('src-tauri/Cargo.lock', root), 'utf8');
  const versions = [
    json('src-tauri/tauri.conf.json').version,
    json('package-lock.json').version,
    json('package-lock.json').packages[''].version,
    cargo.match(/^version = "([^"]+)"/m)?.[1],
    lock.match(/name = "apiforge"\nversion = "([^"]+)"/)?.[1],
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
