# Configuration reference

`npm run setup` covers the common case (API key, PEM path, transport). This page
documents every supported environment variable for advanced or production setups.

Variables are read from `.env.local` then `.env` in the project root (local wins).
The MCP process loads the same files from its working directory; already-set
environment variables always win (`override: false`).

## Required

| Variable | Description |
|----------|-------------|
| `LAMBDA_API_KEY` | Lambda Cloud API key ([create one](https://cloud.lambda.ai/api-keys)). Authenticates all server-side Lambda calls. |
| `LAMBDA_SSH_PEM_PATH` | Absolute path to the `.pem` matching a public key registered in Lambda. Used for the UI `ssh -i` hint and every SSH-based MCP tool. |

## Agent transport

The MCP server picks a transport from these. `LAMBDA_*` is read first, then the
FastMCP CLI-compatible `FASTMCP_*` alias.

| Variable | Default | Description |
|----------|---------|-------------|
| `LAMBDA_MCP_TRANSPORT` | `stdio` | `http` (aliases `httpStream`, `http-stream`) for Poke; `stdio` for Cursor/editors. |
| `LAMBDA_MCP_HTTP_PORT` | `8080` | HTTP listen port. |
| `LAMBDA_MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind host. Keep loopback and tunnel; tools are unauthenticated over HTTP. |
| `LAMBDA_MCP_HTTP_PATH` | `/mcp` | HTTP endpoint path. |
| `LAMBDA_MCP_HTTP_STATELESS` | `false` | `true` matches FastMCP's stateless mode. |
| `FASTMCP_TRANSPORT` / `FASTMCP_PORT` / `FASTMCP_HOST` / `FASTMCP_ENDPOINT` / `FASTMCP_STATELESS` | — | Fallback aliases for the above. |

Security: HTTP mode exposes tools without auth. Bind `127.0.0.1` and reach the
server through a tunnel; do not expose `0.0.0.0` on an untrusted network.

## MCP dotenv loading

| Variable | Description |
|----------|-------------|
| `LAMBDA_DOTENV_PATH` | If set in the shell / Cursor MCP `env`, only that file is loaded. Otherwise `.env.local` then `.env` from the working directory. Cannot be set from inside `.env` to choose the file. |

## Watch / snipe sync (shared by UI and MCP)

The UI persists capacity alerts and snipe prefs to a JSON file; MCP reads them
over HTTP via `get_ui_settings`.

| Variable | Default | Description |
|----------|---------|-------------|
| `LAMBDA_WATCH_HTTP_URL` | `http://127.0.0.1:3000/api/watch-config` | URL MCP GETs for watch/snipe config. The default works while `next dev` runs locally; set it if the UI runs elsewhere. |
| `LAMBDA_WATCH_CONFIG_PATH` | `.lambda/watch-config.json` (dev only) | Where Next writes the JSON. Required in production (`next start`). |
| `LAMBDA_WATCH_ALLOW_SYNC` | `false` | Allows `GET`/`POST /api/watch-config` outside development. |
| `LAMBDA_WATCH_CONFIG_SYNC_SECRET` | — | If set, `/api/watch-config` requires the `x-lambda-watch-sync-secret` header. |
| `NEXT_PUBLIC_LAMBDA_WATCH_SYNC_SECRET` | — | Secret the browser sends when POSTing watch config. |
| `LAMBDA_WATCH_HTTP_SYNC_SECRET` | — | Secret MCP sends on GET; falls back to `LAMBDA_WATCH_CONFIG_SYNC_SECRET`. |

## SSH tuning (MCP)

| Variable | Default | Description |
|----------|---------|-------------|
| `LAMBDA_SSH_USER` | `ubuntu` | Remote SSH user. |
| `LAMBDA_SSH_PORT` | `22` | Remote SSH port. |
| `LAMBDA_SSH_TIMEOUT_MS` | `120000` | Per-command timeout (1000–900000). |
| `LAMBDA_SSH_DISABLE_HOST_KEY_CHECKING` | `true` | Set `false` to enforce host key checking. |

## Training / environment hints

Optional documentation surfaced through `get_status.setup.commandHints`. Not
executed by the server itself — the agent reads them and runs the real command
with `ssh_exec`. See [mcp-ssh-training-hints.md](mcp-ssh-training-hints.md).

| Variable | Description |
|----------|-------------|
| `MCP_ENV_SETUP_COMMAND` | Suggested environment-setup shell. |
| `MCP_TRAINING_START_COMMAND` | Suggested training-start shell. |
| `MCP_TRAINING_STOP_COMMAND` | Suggested training-stop shell. |
| `MCP_TRAINING_STATUS_COMMAND` | Suggested status shell; also enables cost tracking in `get_status`. |
| `MCP_TRAINING_LOG_PATH` | Suggested remote log path to `tail` via `ssh_exec`. |

## Other

| Variable | Description |
|----------|-------------|
| `POKE_API_KEY` | If set, the app POSTs launch details to Poke after a successful launch. |
| `LAMBDA_MCP_DEBUG_TOOLS` | `true` stderr-logs each tool call (name, args, result, duration). |
