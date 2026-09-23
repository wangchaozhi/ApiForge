# ApiForge Roadmap

This roadmap tracks the post-v0.5 development streams. GitHub issues are the source of truth for acceptance criteria and implementation status.

## v0.6 — portability, environments, testability

- [ ] #1 Named environment profiles and secure secrets
  - Environment profile model and legacy migration: **in progress in PR #9**
  - Active-environment request interpolation: **in progress in PR #9**
  - Secret redaction from local persistence/exports: **in progress in PR #9**
  - Tauri Stronghold persistence and unlock UX: pending
- [ ] #2 Workspace backup and Postman import/export
  - Versioned ApiForge workspace format: **in progress in PR #9**
  - Postman Collection v2.1 import/export core: **in progress in PR #9**
  - Postman Environment import/export core: **in progress in PR #9**
  - UI data portability panel: **in progress in PR #9**
- [ ] #3 Automated tests and module split
  - Cross-platform release/version validation: **in progress**
  - cURL/OpenAPI/workspace/environment test expansion: pending
  - Split frontend store and Rust command modules: pending

## v0.7 — automation and enterprise auth

- [ ] #4 Collection Runner and sandboxed pre-request/test scripts
- [ ] #5 OAuth 2.0, Digest Auth, client certificates and authenticated proxies

Script runtimes must be isolated from Node/Tauri primitives. Secrets and certificate passwords must use the secure-secret layer from v0.6.

## v0.8 — additional protocols

- [ ] #6 WebSocket and SSE
- [ ] #7 GraphQL and gRPC

Protocol session state should remain separate from the existing HTTP request runtime so long-lived streams do not complicate ordinary request tabs.

## v1.0 — distribution and security hardening

- [ ] #8 CSP, updater, signing/notarization, migration hardening and release smoke tests

A v1.0 release requires green Windows/macOS/Linux CI, signed update metadata, tested migrations, crash-safe persistence and verified backup/restore behavior.

## Dependency policy

Only stable releases are accepted. Alpha, beta, RC, canary and nightly application dependencies are not used. Security-sensitive storage must not be replaced with hard-coded encryption passwords or reversible local obfuscation.
