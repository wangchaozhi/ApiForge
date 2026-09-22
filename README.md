# ApiForge

ApiForge is a local-first desktop API client inspired by Postman and Insomnia. It uses Tauri 2 for the desktop shell, React + TypeScript for the UI, Rust + reqwest for the native HTTP engine, and SQLite for request history.

## v0.5.0

This iteration expands workspace management, import support, response inspection, and desktop persistence.

### Workspace

- Collection tree with create, rename, delete, and drag-to-reorder actions
- Folder support inside collections
- Requests can be created directly at a collection root or inside a folder
- Duplicate and move requests between collections/folders (or Unfiled)
- Deleting a folder moves its requests to the collection root
- Deleting a collection preserves its requests under **Unfiled**
- Multi-tab request workspace with per-request response/error/loading/cancellation state
- Existing v0.3/v0.4 local workspace data continues to use the `apiforge-workspace-v2` storage key

### OpenAPI / Swagger import

- Import OpenAPI/Swagger documents from JSON or YAML
- OpenAPI 3 `servers` and Swagger 2 host/basePath are mapped to request URLs
- OpenAPI tags become ApiForge folders
- Query, path, and header parameters are imported
- JSON, `application/x-www-form-urlencoded`, and `multipart/form-data` request bodies are imported
- Swagger 2 body/formData requests are supported
- Bearer, Basic, and API Key security schemes map to ApiForge authorization settings

### Requests and responses

- HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Query params and headers
- Authorization: Bearer, Basic, API Key (header/query)
- Body modes: JSON, Raw, `application/x-www-form-urlencoded`, `multipart/form-data`
- Native multipart file selection in the desktop app
- Monaco Editor for request and response bodies
- Pretty JSON, Raw, Headers, and sandboxed HTML Response Preview
- Image and PDF response preview for binary responses
- Text response search with match count and Monaco selection
- Binary responses are transported as Base64 rather than lossy UTF-8
- Real request cancellation in the Rust engine and browser fallback
- Environment variables using `{{variable}}`
- cURL import/export, including urlencoded and multipart fields

### Desktop engine

- SQLite request/response history with restore
- RFC6265 Cookie Store shared across desktop requests
- Cookie Store is restored from the app data directory on startup and saved after requests and cookie mutations
- Cookie Manager: inspect, delete individual cookies, refresh, or clear the jar
- Network settings: timeout, redirects, TLS verification, system/custom proxy
- Browser-only UI preview fallback for fast frontend development

## Stable dependency policy

The project intentionally pins stable releases only—no alpha, beta, RC, canary, or nightly application dependencies.

Key frontend versions in v0.5.0:

- React / React DOM 19.3.0
- TypeScript 7.0.2
- Vite 8.3.0
- Tauri JS API 2.11.1 / CLI 2.11.5
- Tauri Dialog plugin 2.7.3
- Monaco Editor 0.56.0
- Zustand 5.0.15
- Lucide React 1.47.0
- YAML 2.9.1

Key Rust versions:

- Tauri 2.11.6
- base64 0.23.1
- reqwest 0.13.5
- reqwest_cookie_store 0.10.0
- cookie_store 0.22.1
- rusqlite 0.40.2 (`bundled` SQLite)
- Tokio 1.53.1
- tokio-util 0.7.19
- serde 1.0.229
- thiserror 2.0.20
- tauri-plugin-dialog 2.7.3

`reqwest_cookie_store 0.10.0` uses `cookie_store 0.22.x`, whose minimum supported Rust version is 1.88. The repository uses Rust 1.98.1 via `rust-toolchain.toml`.

## Run

Prerequisites:

- Node.js 22+
- Rust 1.98.1 (installed automatically by rustup)
- Tauri platform prerequisites for your operating system

Install dependencies and start the desktop app:

```bash
npm install
npm run tauri dev
```

For frontend-only development:

```bash
npm install
npm run dev
```

Validate the frontend and Rust code:

```bash
npm run check
npm run build

cd src-tauri
cargo check
```

## Architecture

```text
React + TypeScript
  ├─ Collection / Folder tree
  ├─ OpenAPI / Swagger importer
  ├─ Request tabs + per-tab runtime state
  ├─ Monaco request/response editors
  ├─ HTML / image / PDF response preview
  ├─ Environments / History / Cookie Manager
  └─ Network settings
                 │
                 │ Tauri IPC
                 ▼
Rust
  ├─ reqwest HTTP engine
  ├─ cancellable request tasks
  ├─ persistent RFC6265 Cookie Store
  ├─ Proxy / TLS / redirects / timeout
  ├─ multipart file streaming
  └─ SQLite history
```

The request data model remains independent from the UI so a future CLI, Collection Runner, automated test runner, or plugin system can reuse the same request-engine contract.

## Security and runtime notes

- HTML response previews run inside a sandboxed iframe without script privileges from ApiForge itself.
- Multipart file fields store local file paths in the request definition. Review them before sharing workspace data.
- Disabling TLS certificate verification is intended only for trusted development/test endpoints.
- Cookie values may contain credentials/session tokens. The desktop Cookie Store is persisted in the application data directory; treat that profile data as sensitive.
- Browser-only mode is subject to browser CORS/security rules and cannot enumerate ApiForge's native Cookie Store. Native proxy, TLS overrides, desktop cookie inspection, persistence, and file-path multipart upload require the Tauri runtime.

## Languages

ApiForge supports **English** and **简体中文** across the workspace, settings, dialogs,
request editors and response views. Open **Settings → Language** to choose a language
or follow the system language (the default). Chinese system locales use Simplified
Chinese; other locales fall back to English. The choice survives restarts, and changing
languages does not rename saved collections/requests or modify request data.

Translations live in `src/i18n/messages.ts`. English source messages are typed keys;
`{name}` placeholders interpolate display values while `{{variable}}` API variables
remain literal. `npm test` checks language resolution and placeholder parity.

## CI and releases

The toolchain is pinned to Rust **1.98.1** in `rust-toolchain.toml`. Commit both
`package-lock.json` and `src-tauri/Cargo.lock`; CI uses `npm ci` and locked Cargo builds.
Pushes to `main` and pull requests run frontend validation and the same installer
build matrix used by releases:

| Platform | Architecture | Installers |
| --- | --- | --- |
| Windows | x86_64 | NSIS `.exe`, MSI `.msi` |
| macOS | Apple Silicon (arm64) | `.dmg` |
| macOS | Intel (x86_64) | `.dmg` |
| Linux | x86_64 | `.AppImage`, `.deb`, `.rpm` |

**AppImage** is the portable Linux download. It is built on Ubuntu 22.04 for a
glibc 2.35 baseline; it is not a static binary for every Linux system (for example,
Alpine/musl is unsupported). Use a compatible desktop distribution and architecture:

```bash
chmod +x ApiForge_*.AppImage
./ApiForge_*.AppImage
# On systems without FUSE:
./ApiForge_*.AppImage --appimage-extract-and-run
```

To publish, synchronize the versions in `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`, then run
`node scripts/check-release-version.mjs`. Commit and push that change before tagging:

```bash
# Example for the current 0.5.0 version; use the actual version being released.
git tag -a v0.5.0 -m "ApiForge v0.5.0"
git push origin v0.5.0
```

The `Release` workflow rejects a tag whose version differs from the manifests. It
builds all installers, uploads platform artifacts, and publishes the GitHub Release
only after all builds succeed. Tags with a suffix such as `v0.6.0-beta.1` produce
prereleases. Every platform includes a `SHA256SUMS-<platform>.txt` file. A failed
workflow can be rerun; uploads replace assets with the same name. Manual runs on a
branch build downloadable artifacts without publishing or creating a tag.

The default pipeline produces unsigned installers and does not require signing
secrets. macOS notarization and Windows code signing require separately provisioned
certificates before distributing signed builds.
