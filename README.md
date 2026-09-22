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

`reqwest_cookie_store 0.10.0` uses `cookie_store 0.22.x`, whose minimum supported Rust version is 1.88. Use Rust stable 1.88 or newer.

## Run

Prerequisites:

- Node.js 22+
- Rust stable 1.88+
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
