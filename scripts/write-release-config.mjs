import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Tauri config merged into release builds.
 * - The bundler needs the updater public key to produce signed updater artifacts.
 * - Windows: sign with the certificate imported into the runner's store, when configured.
 * - macOS: ad-hoc sign ("-") when no Developer ID certificate is configured, so Apple
 *   Silicon does not report downloaded builds as damaged.
 */
export function releaseConfig({ updaterPubkey, os, windowsThumbprint, appleCertificate }) {
  if (!updaterPubkey) throw new Error('Missing TAURI_UPDATER_PUBKEY repository variable');
  const bundle = { createUpdaterArtifacts: true };
  if (os === 'Windows' && windowsThumbprint) {
    bundle.windows = {
      certificateThumbprint: windowsThumbprint,
      digestAlgorithm: 'sha256',
      timestampUrl: 'http://timestamp.digicert.com',
    };
  }
  if (os === 'macOS' && !appleCertificate) bundle.macOS = { signingIdentity: '-' };
  return { bundle, plugins: { updater: { pubkey: updaterPubkey } } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = releaseConfig({
    updaterPubkey: process.env.UPDATER_PUBKEY,
    os: process.env.RUNNER_OS,
    windowsThumbprint: process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
    appleCertificate: process.env.APPLE_CERTIFICATE,
  });
  writeFileSync(process.argv[2] ?? 'src-tauri/tauri.release.conf.json', JSON.stringify(config, null, 2));
  const signing = config.bundle.windows ? 'Windows certificate' : config.bundle.macOS ? 'macOS ad-hoc' : 'platform default';
  console.log(`Wrote release config (signing: ${signing}).`);
}
