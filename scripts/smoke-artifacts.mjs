import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] ?? 'release-artifacts';
const files = await readdir(root);
const required = ['.deb', '.rpm', '.AppImage', '.dmg', '.exe', '.msi'];
for (const extension of required) {
  const match = files.find((file) => file.endsWith(extension));
  if (!match) throw new Error(`Missing ${extension} installer`);
  const bytes = await readFile(join(root, match));
  if (bytes.length < 4096) throw new Error(`${match} is unexpectedly small`);
}
for (const checksumFile of files.filter((file) => file.startsWith('SHA256SUMS-'))) {
  const lines = (await readFile(join(root, checksumFile), 'utf8')).trim().split('\n');
  for (const line of lines) {
    const [expected, name] = line.trim().split(/\s{2}/);
    const actual = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
    if (actual !== expected) throw new Error(`Checksum mismatch for ${name}`);
  }
}
console.log(`Smoke-checked ${required.length} installer formats and all checksums.`);
