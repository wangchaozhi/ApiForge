# ApiForge module architecture

The frontend and native backend share the same request/response contract. Refactoring
keeps the Tauri command names, camelCase IPC payloads, workspace storage keys (including legacy environment migration), SQLite
schema, cookie filename, and import/export formats compatible with v0.5 workspaces.

## Frontend ownership

| Directory | Responsibility |
| --- | --- |
| `src/app/` | Application composition, navigation, language/history lifecycle |
| `src/domain/` | Request, response, engine, workspace, network, history and cookie types |
| `src/services/http/` | Pure request construction, browser HTTP adapter, desktop/browser dispatch |
| `src/services/curl/` | Shell tokenization, cURL import and export |
| `src/services/openapi/` | Schema examples/references, security, bodies, URL mapping and import orchestration |
| `src/services/history.ts` | History entry construction and desktop/browser persistence |
| `src/services/cookies.ts` | Desktop cookie commands and browser fallback |
| `src/platform/` | Runtime detection |
| `src/store/` | Typed workspace actions, initial data, collection helpers and persistence |
| `src/features/` | Collections, requests, responses, protocols, runner, history, environments, cookies and settings UI |
| `src/shared/` | Reusable fields, Monaco component/runtime and shared styles |
| `src/i18n/` | Translation catalog, interpolation, locale selection and language preference |

Import concrete modules rather than loading a broad implementation barrel. The old
`src/lib/{request,curl,openapi,history}.ts` and `src/types/api.ts` paths remain small
compatibility facades. Application code uses direct imports; tests also exercise the
old public paths to prevent compatibility regressions. `src/lib/id.ts` remains the
shared ID utility.

### Dependency direction

- Domain contracts depend only on other domain contracts.
- Services and platform code do not import application composition, feature views or workspace state.
- Shared UI does not import feature views or workspace state.
- Store modules implement synchronous state transitions; they do not send requests or render UI.
- Features coordinate services with the store. `useRequestExecution` owns sending,
  cancellation and history updates; the request panel owns editing and rendering.
- Application composition chooses feature views and initializes application lifecycle effects.

`tests/architecture.test.mjs` checks relative imports, these lower-layer boundaries,
and circular dependencies. TypeScript also rejects unused local declarations and parameters.

### Workspace state and persistence

`createAppState.ts` composes seven action slices: requests, collections, runtime,
preferences, history, environments and workspace transfer. `types.ts` provides their shared contract. Pure collection
membership operations live in `collections.ts`; constructors/default values live in
`defaults.ts`. Each new store receives fresh starter request/collection identities.

`persistence.ts` owns the persisted projection and legacy restoration. It retains
`apiforge-workspace-v2`, normalizes older request/folder data, filters dangling IDs,
restores valid tabs and fills missing network defaults. In-flight operations,
responses and history are not serialized into the workspace. Browser history retains
`apiforge-browser-history-v1`; language preference retains `apiforge-language-v1`.

Environment profiles are persisted with secret values redacted; request credentials and
network passwords are also redacted. `platform/durableStorage.ts` retains a previous
valid snapshot for recovery. Workspace import/export and schema migrations live in
`services/workspace/`; protocol clients and the secret vault live in `services/`.

### Styles

Feature styles live beside their feature; common primitives live in `shared/styles`.
`src/styles.css` is the explicit import manifest. Its order preserves the previous
CSS cascade. Do not import the same feature stylesheet again from a component.
Cross-feature responsive adjustments remain in `src/styles/responsive-*.css`.

## Native backend

| Module | Responsibility |
| --- | --- |
| `lib.rs` | Initialize managed state and register commands |
| `commands/http.rs` | IPC request/cancellation lifecycle |
| `commands/cookies.rs` | Cookie IPC wrappers |
| `commands/history.rs` | History IPC wrappers |
| `models.rs` | Serialized IPC contracts |
| `error.rs` | Typed errors and frontend error serialization |
| `http.rs` | reqwest execution, body encoding, proxy/TLS/redirect behavior |
| `state.rs` | Shared cookie jar and cancellation registry initialization |
| `cookies.rs` | Cookie enumeration, mutation and disk persistence |
| `database.rs` | SQLite initialization and bounded history storage |

Commands remain `send_request`, `cancel_request`, `clear_cookie_jar`, `list_cookies`,
`remove_cookie`, `save_history`, `list_history`, and `clear_history`, plus script, SSE, WebSocket and gRPC commands.
Protocol implementations live in `sse.rs`, `websocket.rs`, `grpc.rs`, `script.rs` and
`digest.rs`; they use the shared models, errors and HTTP state. SQLite remains
`apiforge.sqlite3`; cookies remain `cookies.json` under the app data directory.
Database methods operate without Tauri command state, allowing in-memory database tests.

## Validation

```sh
npm run check
npm test
npm run build
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
node scripts/check-release-version.mjs
```

Frontend tests cover import/export, request construction, browser transport and
cancellation, response formatting, store actions, workspace restoration and module
boundaries. Native tests cover response content classification and SQLite history
roundtrip/replacement, sorting, retention, limits and clearing.

For a browser smoke test, run `npm run dev`, set a request URL to the dev server's
`/package.json?tag=one&tag=two`, and send it. Verify status 200, the formatted response,
and a history entry retaining both query values. Exercise navigation, request body
editing, language selection and reload persistence. Native cookies/proxy/TLS and
installer packaging require the desktop runtime or platform CI in addition to this
browser check.
