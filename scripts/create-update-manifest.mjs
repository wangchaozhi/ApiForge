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

/** Returns the bullet list under `## <version>` in a changelog, or null when absent. */
export function changelogNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##?\s/.test(line));
  const notes = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return notes || null;
}

export async function createUpdateManifest(root, tag, baseUrl, now = new Date(), notes = `ApiForge ${tag}`) {
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
  const manifest = { version, notes, pub_date: now.toISOString(), platforms };
  await writeFile(join(root, 'latest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, tag, baseUrl] = process.argv.slice(2);
  if (!root || !tag || !baseUrl) throw new Error('Expected artifact root, tag and release URL');
  const changelog = await readFile('CHANGELOG.md', 'utf8').catch(() => '');
  const notes = changelogNotes(changelog, tag.replace(/^v/, '')) ?? `ApiForge ${tag}`;
  const manifest = await createUpdateManifest(root, tag, baseUrl, new Date(), notes);
  console.log(`Created signed update manifest for ${manifest.version}: ${Object.keys(manifest.platforms).join(', ')}.`);
}
