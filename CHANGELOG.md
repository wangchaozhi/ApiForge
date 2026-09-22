## Unreleased

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
