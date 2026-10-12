import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Tauri v2 updater artifacts: macOS uses the .app.tar.gz archive, Linux the AppImage and
// Windows the NSIS installer itself (each with a detached minisign .sig).
export const UPDATER_PLATFORMS = [
  ['darwin-aarch64', /_aarch64\.app\.tar\.gz\.sig$/i],
  ['darwin-x86_64', /_x64\.app\.tar\.gz\.sig$/i],
  ['linux-x86_64', /\.AppImage\.sig$/i],
  ['windows-x86_64', /x64-setup\.exe\.sig$/i],
];

export async function createUpdateManifest(root, tag, baseUrl, now = new Date()) {
  const version = tag.replace(/^v/, '');
  const signatures = (await readdir(root)).filter((file) => file.endsWith('.sig'));
  const platforms = {};
  for (const [platform, pattern] of UPDATER_PLATFORMS) {
    const signatureFile = signatures.find((file) => pattern.test(file));
    if (!signatureFile) throw new Error(`Missing updater signature for ${platform}`);
    const archive = basename(signatureFile, '.sig');
    platforms[platform] = {
      signature: (await readFile(join(root, signatureFile), 'utf8')).trim(),
      url: `${baseUrl}/${encodeURIComponent(archive)}`,
    };
  }
  const manifest = { version, notes: `ApiForge ${tag}`, pub_date: now.toISOString(), platforms };
  await writeFile(join(root, 'latest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, tag, baseUrl] = process.argv.slice(2);
  if (!root || !tag || !baseUrl) throw new Error('Expected artifact root, tag and release URL');
  const manifest = await createUpdateManifest(root, tag, baseUrl);
  console.log(`Created signed update manifest for ${manifest.version}: ${Object.keys(manifest.platforms).join(', ')}.`);
}
