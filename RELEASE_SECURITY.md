# Release signing and update security

ApiForge release builds fail closed unless updater signing is configured. Set the repository variable `TAURI_UPDATER_PUBKEY` and the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep an offline recovery copy of the updater private key; rotating it requires shipping a trusted application update with the new public key first.

For macOS signing and notarization, configure `APPLE_CERTIFICATE` (base64 PKCS#12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`. For Windows, configure the organization-owned Authenticode certificate in the runner or extend the release workflow with the selected managed signing provider. Never store certificates or passwords in the repository.

The release workflow builds all four target variants, verifies checksums and installer presence, generates a signed `latest.json`, and only then publishes the GitHub Release. Production tags must match every package manifest exactly. Downgrades are not offered by the updater because the release endpoint only advertises the latest semantic version.

## Self-signed code signing

Until CA-issued certificates are available, releases use self-signed code signing:

- **Windows**: installers and the portable executable are Authenticode-signed and timestamped with a self-signed certificate (`CN=ApiForge (self-signed)`, SHA-1 thumbprint `20E6A3A09BF1A49F5F9D8C577C4F7766FE2B1EAF`, valid until 2031-10-12). The workflow imports the PFX from the `WINDOWS_CERTIFICATE` (base64) and `WINDOWS_CERTIFICATE_PASSWORD` secrets and fails the build if any Windows artifact is not signed and timestamped with it. The public certificate is committed at `certs/ApiForge-codesign.cer` and attached to every release.
- **macOS**: without Apple Developer ID secrets, builds are ad-hoc signed so Apple Silicon does not report downloads as damaged.

A self-signed signature proves the files were not modified after signing, but Windows SmartScreen still reports an unknown publisher and macOS Gatekeeper still requires right-click → Open on first launch. Users who want Windows to show the verified publisher can import `ApiForge-codesign.cer` into *Trusted Publishers* and *Trusted Root Certification Authorities* (only do this if you trust this repository's maintainers).

To rotate the Windows certificate, generate a new code-signing certificate, replace both secrets and `certs/ApiForge-codesign.cer`, and update the thumbprint above. Replacing it with a CA-issued certificate needs no workflow changes.
