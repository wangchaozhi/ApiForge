# ApiForge on the web

The ApiForge UI also runs as a plain web app. A browser on its own cannot send arbitrary
API requests: CORS hides cross-origin responses, `Cookie`/`Host`/`User-Agent` and other
headers are forbidden, TLS verification cannot be disabled, and Digest auth needs to see
the 401 challenge. The web build therefore sends requests through **apiforge-agent**, a
small server that executes them with the same Rust engine as the desktop app
(`crates/apiforge-engine`).

```text
Desktop app   React UI ──Tauri IPC──────────────► apiforge-engine ──► API
Web + agent   React UI ──HTTP + bearer token────► apiforge-agent ──► API
Web only      React UI ──window.fetch (CORS)─────────────────────────► API
```

The UI picks the engine automatically: Tauri when running as the desktop app, otherwise
the agent configured in **Settings → Request agent**, otherwise `fetch`.

## Agent modes

| | `local` (default) | `relay` |
| --- | --- | --- |
| Intended for | Your own computer | A shared server next to a hosted web app |
| Default listen address | `127.0.0.1:47811` | set `--listen` explicitly |
| localhost / intranet / private IPs | allowed | refused (literal IPs, DNS results and every redirect hop) |
| Multipart files and client certificates from local paths | allowed | refused |
| Custom / system proxy | allowed | refused |
| Cookie jar | in-memory, shared by that agent's requests | none (users would share it) |
| Response size limit | none | `--max-response-bytes` (20 MiB default) |
| Token | generated on first start if not given | required (`--token`, `--token-file` or `APIFORGE_AGENT_TOKEN`) |

Every endpoint except `/v1/health` requires `Authorization: Bearer <token>`. Because the
agent never authenticates through cookies, any origin may call it by default; restrict
origins with `--allow-origin https://forge.example.com` (repeatable or comma-separated).

## Scenario 1: personal agent (development or daily use)

```bash
npm install
npm run agent          # cargo run of agent/ in local mode
npm run dev            # in another terminal
```

On first start the agent writes a token to `~/.config/apiforge/agent-token`
(`%APPDATA%\apiforge\agent-token` on Windows, `~/Library/Application Support/apiforge/`
on macOS) and prints it with the URL. Open **Settings → Request agent** in the web app,
tick *Send requests through apiforge-agent*, paste the token and press *Test connection*.
A local agent can reach `localhost` and intranet APIs, exactly like the desktop app.

## Scenario 2: hosted web app with a relay

One binary serves the built UI and relays requests to public APIs:

```bash
npm ci && npm run build
cargo build --release --manifest-path agent/Cargo.toml
APIFORGE_AGENT_TOKEN="$(openssl rand -hex 24)" \
  agent/target/release/apiforge-agent --mode relay --listen 0.0.0.0:8080 --static-dir dist
```

Put it behind your usual HTTPS reverse proxy. Users enter the shared token once; when the
page is served by an agent, Settings pre-fills the agent URL with the page's own origin.
The relay is an outbound proxy for everyone who has the token, so keep the token secret,
rotate it if it leaks, and add rate limiting at the reverse proxy if the deployment is
public.

## Scenario 3: hosted web app with each user's local agent

Users open the hosted UI and run `apiforge-agent` on their own machine, then point
Settings at `http://127.0.0.1:47811`. The agent answers Chrome's Private Network Access
preflight (`Access-Control-Allow-Private-Network`). Chromium and Firefox allow an HTTPS
page to call `http://127.0.0.1`; other browsers may block it as mixed content. Add
`--allow-origin https://your-hosted-ui` so only that site can use the agent.

## HTTP API

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /v1/health` | – | `{ status, name: "apiforge-agent", version }`, no token needed |
| `GET /v1/info` | – | `{ name, version, mode, capabilities: { localFiles, proxies, privateNetworks, cookieJar, maxResponseBytes } }` |
| `POST /v1/http/send` | `{ operationId, request: EngineRequest }` | `EngineResponse` (same JSON as the desktop `send_request` command) |
| `POST /v1/http/cancel` | `{ operationId }` | `204`; the pending send returns `409 { kind: "cancelled" }` |

Errors are `{ error, kind }` with `kind` one of `unauthorized` (401), `policy` (403),
`invalid_request` (400), `timeout` (504), `upstream`, `authentication`, `filesystem`,
`response_too_large` (502) or `cancelled` (409). Closing the HTTP connection also aborts
the outgoing request.

## Web build limitations

These still require the desktop app: SSE, WebSocket and gRPC panels, sandboxed request
scripts, the Cookie Manager, SQLite history (the web build keeps history in browser
storage), the Stronghold secret vault, and picking files for multipart uploads.
