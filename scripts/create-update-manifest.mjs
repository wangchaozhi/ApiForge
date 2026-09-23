import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const [root, tag, baseUrl] = process.argv.slice(2);
if (!root || !tag || !baseUrl) throw new Error('Expected artifact root, tag and release URL');
const version = tag.replace(/^v/, '');
const files = await readdir(root);
const candidates = files.filter((file) => file.endsWith('.sig'));
const platforms = {};
const mappings = [
  ['darwin-aarch64', /aarch64.*\.app\.tar\.gz\.sig$/i],
  ['darwin-x86_64', /x64.*\.app\.tar\.gz\.sig$|x86_64.*\.app\.tar\.gz\.sig$/i],
  ['linux-x86_64', /\.AppImage\.sig$/i],
  ['windows-x86_64', /x64.*\.(?:nsis|msi)\.zip\.sig$|x86_64.*\.(?:nsis|msi)\.zip\.sig$/i],
];
for (const [platform, pattern] of mappings) {
  const signatureFile = candidates.find((file) => pattern.test(file));
  if (!signatureFile) throw new Error(`Missing updater signature for ${platform}`);
  const archive = basename(signatureFile, '.sig');
  platforms[platform] = {
    signature: (await readFile(join(root, signatureFile), 'utf8')).trim(),
    url: `${baseUrl}/${encodeURIComponent(archive)}`,
  };
}
await writeFile(join(root, 'latest.json'), JSON.stringify({ version, notes: `ApiForge ${tag}`, pub_date: new Date().toISOString(), platforms }, null, 2));
console.log(`Created signed update manifest for ${version}.`);
