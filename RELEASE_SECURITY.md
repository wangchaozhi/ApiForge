# Release signing and update security

ApiForge release builds fail closed unless updater signing is configured. Set the repository variable `TAURI_UPDATER_PUBKEY` and the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep an offline recovery copy of the updater private key; rotating it requires shipping a trusted application update with the new public key first.

For macOS signing and notarization, configure `APPLE_CERTIFICATE` (base64 PKCS#12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`. For Windows, configure the organization-owned Authenticode certificate in the runner or extend the release workflow with the selected managed signing provider. Never store certificates or passwords in the repository.

The release workflow builds all four target variants, verifies checksums and installer presence, generates a signed `latest.json`, and only then publishes the GitHub Release. Production tags must match every package manifest exactly. Downgrades are not offered by the updater because the release endpoint only advertises the latest semantic version.
