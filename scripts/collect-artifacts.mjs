import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

const [target, platform, bundles] = process.argv.slice(2);
if (!target || !platform || !bundles) throw new Error('Expected target, platform and bundles');
const root = `src-tauri/target/${target}/release/bundle`;
const extensions = { appimage: '.AppImage', deb: '.deb', rpm: '.rpm', dmg: '.dmg', nsis: '.exe', msi: '.msi' };
const files = (await readdir(root, { recursive: true })).filter((file) =>
  bundles.split(',').some((bundle) => file.endsWith(extensions[bundle])),
).sort();
const updaterFiles = (await readdir(root, { recursive: true })).filter((file) =>
  file.endsWith('.sig') || file.endsWith('.tar.gz') || file.endsWith('.nsis.zip') || file.endsWith('.msi.zip'),
).sort();
for (const bundle of bundles.split(',')) {
  if (!files.some((file) => file.endsWith(extensions[bundle]))) throw new Error(`Missing ${bundle} installer`);
}
await mkdir('release-artifacts', { recursive: true });
const hashes = [];
const names = new Set();
for (const file of [...files, ...updaterFiles]) {
  const name = basename(file);
  if (names.has(name)) throw new Error(`Duplicate installer name: ${name}`);
  names.add(name);
  await copyFile(join(root, file), join('release-artifacts', name));
  const hash = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  hashes.push(`${hash}  ${name}`);
}
await writeFile(`release-artifacts/SHA256SUMS-${platform}.txt`, `${hashes.join('\n')}\n`);
console.log(`Collected ${files.length} installers and ${updaterFiles.length} updater files for ${platform}`);
