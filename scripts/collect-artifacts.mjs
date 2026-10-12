import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Each bundle type lives in its own directory under target/<triple>/release/bundle.
const BUNDLES = {
  appimage: { dir: 'appimage', extension: '.AppImage' },
  deb: { dir: 'deb', extension: '.deb' },
  rpm: { dir: 'rpm', extension: '.rpm' },
  dmg: { dir: 'dmg', extension: '.dmg' },
  nsis: { dir: 'nsis', extension: '.exe' },
  msi: { dir: 'msi', extension: '.msi' },
};

const listFiles = async (dir) => {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
};

/** Architecture label used in installer names, e.g. aarch64 or x64. */
export function archLabel(target) {
  if (target.startsWith('aarch64')) return 'aarch64';
  if (target.startsWith('x86_64')) return 'x64';
  return target.split('-')[0];
}

/**
 * Copies installers, their updater signatures and the macOS updater archive into `outDir`
 * and writes SHA256SUMS-<platform>.txt. Only top-level files of each bundle directory are
 * considered, so bundler intermediates (deb control/data archives, .app contents) are skipped.
 * The macOS archive is renamed per architecture because both builds emit ApiForge.app.tar.gz.
 */
export async function collectArtifacts({ bundleRoot, outDir, target, platform, bundles, version }) {
  const copies = [];
  for (const bundle of bundles) {
    const spec = BUNDLES[bundle];
    if (!spec) throw new Error(`Unknown bundle type: ${bundle}`);
    const dir = join(bundleRoot, spec.dir);
    const files = await listFiles(dir);
    const installers = files.filter((file) => file.endsWith(spec.extension));
    if (!installers.length) throw new Error(`Missing ${bundle} installer`);
    for (const installer of installers) {
      copies.push([join(dir, installer), installer]);
      if (files.includes(`${installer}.sig`)) copies.push([join(dir, `${installer}.sig`), `${installer}.sig`]);
    }
  }

  if (bundles.includes('dmg')) {
    const dir = join(bundleRoot, 'macos');
    const files = await listFiles(dir);
    const archive = files.find((file) => file.endsWith('.app.tar.gz'));
    if (archive) {
      const name = `ApiForge_${version}_${archLabel(target)}.app.tar.gz`;
      copies.push([join(dir, archive), name]);
      if (files.includes(`${archive}.sig`)) copies.push([join(dir, `${archive}.sig`), `${name}.sig`]);
    }
  }

  await mkdir(outDir, { recursive: true });
  const names = new Set();
  const hashes = [];
  for (const [source, name] of copies) {
    if (names.has(name)) throw new Error(`Duplicate artifact name: ${name}`);
    names.add(name);
    await copyFile(source, join(outDir, name));
    hashes.push(`${createHash('sha256').update(await readFile(source)).digest('hex')}  ${name}`);
  }
  await writeFile(join(outDir, `SHA256SUMS-${platform}.txt`), `${hashes.join('\n')}\n`);
  return [...names];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [target, platform, bundles] = process.argv.slice(2);
  if (!target || !platform || !bundles) throw new Error('Expected target, platform and bundles');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const names = await collectArtifacts({
    bundleRoot: `src-tauri/target/${target}/release/bundle`,
    outDir: 'release-artifacts',
    target,
    platform,
    bundles: bundles.split(','),
    version,
  });
  const signatures = names.filter((name) => name.endsWith('.sig')).length;
  console.log(`Collected ${names.length - signatures} artifacts and ${signatures} updater signatures for ${platform}: ${names.join(', ')}`);
}
