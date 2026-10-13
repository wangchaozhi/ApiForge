## 1.0.1

- Automatic updates: checks the signed release channel shortly after launch and every 6 hours, shows an in-app banner with release notes, download progress and one-click install and restart. Can be turned off in Settings → Updates.
- Windows installers and the portable executable are Authenticode-signed with a self-signed certificate (verified in CI); macOS builds are ad-hoc signed. The public certificate is attached to each release.
- Add a portable Windows zip (`ApiForge_<version>_x64-portable.zip`) alongside the NSIS and MSI installers.
- Release pipeline fixes: updater key passed to the bundler, macOS updater archives built and collected per architecture, Tauri v2 Windows updater artifacts, codesigning skipped when no Apple certificate is configured.

## 1.0.0

- SSE: EventSource-compliant reconnect (204/non-2xx/content-type are fatal), exponential backoff, live setting changes, Last-Event-ID reset per connection, connection statistics.
- GraphQL: schema-driven autocomplete, full type browser, query formatting, syntax highlighting, operation-name validation, depth-limit tolerant introspection.
- WebSocket: proxy (HTTP CONNECT + auth) support, connect timeout and cancellable connects, Base64 binary frames, ping, graceful close handshake, incoming/outgoing timeline.
- gRPC: `.proto` import, request templates, client/bidirectional streaming, live server-stream timeline, cancellation, `-bin` metadata, headers/trailers, TLS verification toggle, PKCS#12 certificates and proxy support.
- Add a web build request path: `apiforge-agent` (local and relay modes) executes browser requests with the desktop engine, configured in Settings → Request agent.
- Extract the HTTP engine into the shared `crates/apiforge-engine` crate used by the desktop app and the agent; request errors now include the underlying cause.

- Consolidate upstream protocol/auth/environment and v1.0 update/persistence work on main while preserving module boundaries.
- Fix GraphQL environment subscriptions causing an infinite render loop.

- Refactor frontend into domain contracts, transport/import services, typed store slices, feature UI and shared components.
- Split native IPC commands, HTTP execution, cookies, database, state and models into dedicated Rust modules.
- Organize styles by feature while preserving the cascade, and add module-boundary and behavior regression checks.

- Quote shell-sensitive URL and body characters in exported cURL commands.

- Preserve repeated query parameters and existing URL query values when sending requests.

- Add persisted English / Simplified Chinese language selection and system-language detection.
- Fix Node type definitions, Monaco worker exports, Cookie Store ownership and missing desktop icons.
- Pin Rust 1.98.1 and commit npm/Cargo lockfiles for reproducible CI.
- Build Windows installers, macOS Intel/Apple Silicon DMGs, and Linux AppImage/deb/rpm on CI.
- Publish complete tag releases with version validation and per-platform SHA-256 checksums.

# Changelog

## 0.5.0

- Added drag-to-reorder for collections.
- Added request Duplicate and Move actions.
- Added OpenAPI 3 / Swagger 2 import from JSON and YAML.
- Added mapping for tags, servers/base paths, parameters, JSON/urlencoded/multipart bodies, and common auth schemes.
- Added persistent desktop Cookie Store loading/saving in the app data directory.
- Added response text search with match count.
- Added Base64 transport for binary responses.
- Added image and PDF response previews.
- Added GitHub Actions CI for frontend type/build checks and Rust `cargo check`.
- Updated application version metadata to 0.5.0.

## 0.4.0

- Added Collection and Folder management.
- Added multi-tab request editing with per-request response state.
- Added native request cancellation using cancellation tokens.
- Replaced the opaque reqwest cookie jar with an enumerable RFC6265 cookie store.
- Added Cookie Manager UI with refresh, individual deletion, and clear-all actions.
- Added Monaco-backed response Pretty/Raw views.
- Added sandboxed HTML response preview.
- Added migration for pre-collection v0.3 workspace data.
