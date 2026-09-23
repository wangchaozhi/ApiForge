# ApiForge Development Roadmap

> Last updated: 2026-09-23
>
> This file is the implementation plan after v0.6. GitHub issues remain the source of truth for detailed acceptance criteria, while this roadmap records the actual repository status, development order, and merge gates.

## Current status

### main — v0.6 foundation: merged

The v0.6 foundation is now on `main`.

Completed:

- Named Environment profiles with active-environment switching.
- Environment variable interpolation across requests.
- Tauri Stronghold 2.3.2 secret vault with Argon2 KDF and per-install salt.
- Secret values excluded from localStorage/workspace export by default.
- ApiForge versioned workspace import/export.
- Postman Collection v2.1 and Postman Environment import/export.
- SQLite History extracted into a dedicated Rust module.
- Cross-platform CI/installers verified on Windows, Linux, macOS Intel, and macOS ARM.

Still open from the original v0.6 quality work:

- Expand automated coverage for cURL round-trip, OpenAPI import, environment migration/interpolation, auth, cookies, cancellation, and workspace migration.
- Split the oversized frontend Zustand store into focused slices.
- Continue splitting Rust `lib.rs` into HTTP/cookies/security/commands modules.

---

## v0.7 — automation and enterprise authentication

Active branch: `develop/v0.7`  
Active PR: #10  
Issues: #4, #5

### Implemented / in validation

- Collection Runner:
  - sequential collection execution
  - iterations
  - delay
  - stop-on-failure behavior
  - cancellation
  - History writes
  - per-request results
- Pre-request and Test Script editors.
- Sandboxed JavaScript runtime using Boa 0.22:
  - no DOM, Node.js, filesystem, network, or Tauri host access
  - bounded script size, loop count, recursion, stack, and ArrayBuffer allocation
  - dynamic `eval` / `Function` compilation disabled
  - controlled `af.environment`, `af.request.headers`, `af.response`, `af.test`, `af.expect`, and console APIs
- Postman pre-request/test script preservation.
- OAuth 2.0:
  - Client Credentials flow
  - Authorization Code flow
  - PKCE S256
  - authorization URL generation
  - code-to-token exchange
  - existing access token applied as Bearer auth
- Credentials are redacted from workspace/localStorage/export by default.
- Proxy username/password and client-certificate settings UI/data model:
  - PKCS#12 / P12 / PFX
  - PEM + PKCS#8 key
  - session-only proxy/certificate passwords

### Not finished yet

These are the remaining v0.7 blockers:

- Wire authenticated proxy credentials into the Rust reqwest client.
- Wire client certificates into the Rust reqwest client for normal HTTP, GraphQL, SSE, Runner, and future WebSocket connections.
- Add Digest Auth.
- Add OAuth refresh-token handling and token refresh.
- Move OAuth access/refresh tokens, proxy passwords, API keys, Bearer tokens, Basic passwords, and certificate passwords from session-only memory into the Stronghold secret layer.
- Add Runner environment selector instead of always using the currently active environment.
- Add runner/script regression tests and OAuth integration tests.
- Finish frontend/Rust module decomposition before adding more protocol engines.

### v0.7 merge gate

PR #10 can leave Draft only when:

1. Windows/Linux/macOS Intel/macOS ARM CI is green.
2. Auth secrets are never persisted in plaintext.
3. Proxy auth and client certificates work in the native HTTP engine.
4. Digest Auth is implemented or explicitly deferred to the next milestone.
5. Runner cancellation and sandbox limit tests are green.

---

## v0.8 — protocol clients

Active branch: `develop/v0.8`  
Active PR: #11  
Issues: #6, #7

### Implemented / in progress

#### GraphQL

- Dedicated GraphQL workspace.
- Query editor.
- Variables JSON editor.
- Operation name.
- Headers/Auth integration.
- Native HTTP-engine Send/Cancel.
- JSON response display.
- Schema introspection.
- Schema type/field browser and search.

#### SSE

- Separate protocol runtime model.
- Native reqwest streaming command.
- Shared TLS/proxy/cookie/environment configuration.
- Cancellation through the existing request cancellation model.
- Streaming UTF-8 decoding safe across network chunk boundaries.
- SSE event parsing.
- Event list + raw stream UI.
- Bounded event/raw-text memory.

### Not finished yet

#### WebSocket — not started

- Native WebSocket connection engine.
- Headers/Auth.
- TLS/proxy/client-certificate reuse.
- Text/binary message send.
- Incoming/outgoing message history.
- JSON formatting.
- ping/pong visibility.
- reconnect controls.
- cancellation/close semantics.
- protocol tests.

#### SSE — remaining

- Reconnect policy and retry controls.
- Last-Event-ID reconnect behavior.
- Connection duration / message counters.
- Parser and cancellation regression tests.
- Persistable SSE request definitions if protocol workspaces become part of Collections.

#### GraphQL — remaining

- Schema-driven autocomplete.
- Field/argument/type detail panel.
- Query formatting.
- Persist GraphQL requests inside Collections.
- Subscription support, preferably over the WebSocket engine after WebSocket is complete.

#### gRPC — not started

Implement in two phases:

1. gRPC unary:
   - protobuf import
   - package/service/method explorer
   - request JSON editor
   - metadata
   - TLS
   - unary invocation
2. gRPC streaming:
   - server streaming
   - client streaming
   - bidi streaming
   - stream cancellation
   - message timeline

### v0.8 merge gate

1. Rebase/sync onto the final v0.7 mainline before protocol CI is considered valid.
2. WebSocket and SSE use separate long-lived runtime state from ordinary HTTP tabs.
3. GraphQL uses the common authentication/network stack.
4. At least gRPC unary is functional before declaring v0.8 complete.
5. Protocol parser/runtime tests cover cancellation and malformed input.

---

## v1.0 — security, update, signing, and release hardening

Active branch: `develop/v1.0`  
Active PR: #12  
Issue: #8

### Implemented foundation

- Explicit production CSP.
- Development CSP compatible with Vite/local development.
- Existing multi-platform installer build and GitHub Release workflow.

### Not finished yet

- Tauri signed automatic updater.
- Update-channel policy and update UI.
- Signed update metadata/key management.
- macOS Developer ID signing.
- macOS notarization and stapling.
- Windows code signing.
- Release secret documentation.
- Migration tests from older workspace/store versions.
- Crash-safe persistence for settings/workspace mutations.
- Backup/restore verification tests.
- Release smoke tests for every installer format.
- Security review of Tauri capabilities/permissions.
- Verify CSP after WebSocket/SSE/GraphQL/Monaco changes.
- Define a supported data-migration policy for v1.x.

### v1.0 release gate

A v1.0 tag must not be cut until:

- all supported platform installers are signed where applicable;
- the updater verifies signed metadata;
- clean install, upgrade, downgrade-rejection, backup, restore, and migration scenarios are tested;
- no auth/secret field is stored in plaintext;
- release CI and smoke tests pass on Windows, Linux, macOS Intel, and macOS ARM.

---

## Execution order

### P0 — finish and merge v0.7

1. Finish Rust proxy-auth and client-certificate wiring.
2. Finish secure credential storage using Stronghold.
3. Add Digest Auth and OAuth refresh handling.
4. Expand Runner/auth tests.
5. Complete four-platform CI.
6. Merge PR #10 into `main`.

Do not start additional v0.7 features after the merge gate is met.

### P1 — resync and finish v0.8 transport layer

1. Sync `develop/v0.8` onto the merged v0.7 mainline.
2. Stabilize SSE and add reconnect/Last-Event-ID.
3. Implement WebSocket.
4. Add GraphQL autocomplete/persistence.
5. Implement gRPC unary.
6. Implement gRPC streaming.
7. Complete protocol tests and merge PR #11.

### P2 — architecture and test debt

Before v1.0 release hardening:

- split Zustand state into request/collection/environment/history/settings slices;
- split Rust networking into HTTP, cookies, auth/security, protocols, and commands modules;
- add regression coverage for import/export/migration/auth/cookies/cancellation/protocol parsing;
- add integration fixtures for local HTTP/SSE/WebSocket/gRPC test servers.

### P3 — v1.0 distribution

1. Resync `develop/v1.0` after v0.8 merges.
2. Re-validate and tighten CSP/capabilities.
3. Add signed updater.
4. Add macOS signing/notarization.
5. Add Windows signing.
6. Add migration/backup/restore tests.
7. Add installer smoke tests.
8. Run release candidate validation.
9. Tag v1.0 only after the release gate is satisfied.

---

## Branch policy

To reduce stacked-branch drift:

- Keep only one milestone branch actively changing at a time.
- Merge a milestone into `main` before treating the next milestone branch as release-valid.
- After a parent milestone merges, immediately sync/rebase the child branch and rerun the full CI matrix.
- Do not evaluate child-branch CI as authoritative while its parent branch is still moving.
- Keep temporary lockfile/test workflows out of the final branch after they have served their purpose.

## Dependency policy

- Use stable releases only.
- Do not introduce alpha, beta, RC, canary, or nightly application dependencies.
- Pin security-sensitive plugins and protocol engines through lockfiles.
- Prefer extending the existing reqwest/Tauri network stack over creating parallel HTTP implementations.
- Never replace Stronghold with hard-coded passwords, reversible obfuscation, or plaintext fallback storage.

## Issue mapping

- #1 Environment profiles and secure secrets — functional foundation merged; keep open only for remaining migration/test coverage.
- #2 Workspace backup and Postman import/export — functional foundation merged; keep open only for remaining migration/round-trip tests.
- #3 Automated tests and module split — still active.
- #4 Collection Runner and sandbox scripts — active in PR #10.
- #5 OAuth2/client certificates/proxy authentication — active in PR #10.
- #6 WebSocket and SSE — SSE in progress; WebSocket pending in PR #11.
- #7 GraphQL and gRPC — GraphQL in progress; gRPC pending in PR #11.
- #8 Security/updater/signing — CSP foundation only; most v1.0 work remains in PR #12.
