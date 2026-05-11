# Lambda Cloud Orchestration UI + MCP

My biggest blocker over the past few months was GPU availability. Lambda is my favorite platform because it has much less friction to setup than hyperscalers like GCP, but popular GPUs still disappear fast, and I am tired of manually refreshing a tab. This repo aims to not only automate the entire GPU provisioning process, but also provides post-provisioning handoff to agents via MCP. My main intention is to plug this MCP into [Poke](https://poke.com/), so I can agentically orchestrate everything via text message. This way I can step away from the computer and still handle everything from my phone. The MCP surface is feature-complete for the Poke loop (provision → sync repo → start run → tail logs → stop), but expect breakage as I keep iterating.

---

## Orchestration UI

A **Next.js 16** app that polls the [Lambda Cloud HTTP API](https://docs-api.lambda.ai/api/cloud) for GPU capacity, launches instances, lists and terminates runners, optional capacity **alerts** and **Snipe** (auto-launch), and a suggested `ssh -i` using your `.pem`. Use it to configure what MCP later reads over HTTP, and to operate visually.

![Alerts and Snipe](PoC2.png)

Setup alerts for desired GPUs. Optionally auto-provision GPUs right when they become available via the sniping option. Region scopes include **Any Region**, high-level areas like **Us-East**, or a granular zone such as **`us-east-1`**.

![Capacity table](PoC.png)

See available GPUs in real near-time, with built-in safeguards to prevent going over lambda rate limits. When alerts are triggered and a desired GPU becomes available, rows flash and the page beeps. Launch and terminate GPUs from the same page.

All Lambda calls go through **this app’s server routes**; the API key stays out of the client bundle. Optional session overrides for **API key** and **PEM path** live under **Settings** and are sent only to this app’s APIs.

**Prerequisites:** Node **20+**, a [Lambda API key](https://cloud.lambda.ai/api-keys), an SSH **public** key registered in Lambda, and a local **`.pem`** matching it (for the displayed SSH command only; not sent to Lambda when only the path is configured).

### Setup

1. Copy [`.env.example`](.env.example) to **`.env.local`** or **`.env`** in the project root.
2. Set **`LAMBDA_API_KEY`** (required for server-side Lambda calls). Set **`LAMBDA_SSH_PEM_PATH`** if you want the suggested SSH path filled in (still not sent to Lambda as key material).
3. For MCP + synced watch/snipe JSON: **`npm run dev`** auto-persists to **`.lambda/watch-config.json`** unless **`LAMBDA_WATCH_CONFIG_PATH`** overrides — no env var needed for that path in development. For **`next start`/production**, set **`LAMBDA_WATCH_CONFIG_PATH`** explicitly. With the app open, use **MCP setup** on the home page for a derived **`LAMBDA_WATCH_HTTP_URL`** and a copy-paste env block; or set **`LAMBDA_WATCH_HTTP_URL`** yourself (example **`http://127.0.0.1:3000/api/watch-config`**). Optional auth/gating vars (**`LAMBDA_WATCH_CONFIG_SYNC_SECRET`**, **`NEXT_PUBLIC_LAMBDA_WATCH_SYNC_SECRET`**, **`LAMBDA_WATCH_HTTP_SYNC_SECRET`**, **`LAMBDA_WATCH_ALLOW_SYNC`**) are documented in [`.env.example`](.env.example).
4. **`npm install`** then **`npm run dev`** → [http://localhost:3000](http://localhost:3000). On Windows you can run [`dev.cmd`](dev.cmd) instead.

**Optional overrides for the current session:** API key and PEM path in **Settings** (sent only to this app’s APIs).

### Behavior

- **Capacity poll:** default **5s**, minimum **2s** in Settings. Ease off if you hit rate limits (~1 req/s account-wide is a rough guide).
- **Pause:** fast capacity polling stops while you have any running instance or a launch is in flight. If you have at least one alert configured, capacity still refreshes on a **45s** interval so alerts/Snipe can see stock appear.
- **Instances:** `GET /instances` every **15s**. Same API key in env or Settings → running machines still show after reload.
- **Refresh now** in Settings forces an immediate capacity fetch when you need it.
- **Alerts:** after the first successful instance-types load, **Setup alerts** picks watched GPU types (cached in **`localStorage`**, synced to disk when a watch-config path is active so MCP can GET the same data). Optional **watch region**, rows pinned to the top. If the server file differs from what this browser cached, resolve with **Use server (match MCP)** or **Keep this browser**. Capacity in scope → row flashes + repeating beep until that scope shows no capacity; most browsers need a **click anywhere** first (or **Test alert** on its button).
- **Snipe:** auto-launch when watched capacity **newly** appears, only with **no** running instances and not during launch/cooldown; **~12s** between launch attempts. Region/SSH key come from the alert panel (SSH key can default to the first key in the account).
- **After Snipe:** if the beep keeps going (e.g. API still reports capacity), **Remove alert** or **uncheck** the type in the catalog to stop watching and silence the alarm.
- **SSH hint:** default `ubuntu` @ port **22**; adjust if your image differs.

---

## MCP server

Run **`npm run mcp`** ([`src/mcp/server.ts`](src/mcp/server.ts)). **`LAMBDA_API_KEY`** is required (environment of whatever launches MCP, optionally filled from **`LAMBDA_DOTENV_PATH`**).

**HTTP Stream (e.g. `npx poke … tunnel`):** set **`LAMBDA_MCP_TRANSPORT=http`** (or **`httpStream`**) so FastMCP listens for Streamable HTTP instead of stdio. Use **`LAMBDA_MCP_HTTP_PORT`** (default **8080**), **`LAMBDA_MCP_HTTP_HOST`** (default **127.0.0.1**), and **`LAMBDA_MCP_HTTP_PATH`** (default **`/mcp`**). On startup, FastMCP logs the full URL (e.g. `http://127.0.0.1:8080/mcp`). Optional **`LAMBDA_MCP_HTTP_STATELESS=true`** matches FastMCP’s stateless mode. **Security:** tools are not authenticated over HTTP—keep **`127.0.0.1`** and reach the server through a tunnel; do not expose **`0.0.0.0`** on a public interface without your own controls.

**Dotenv bootstrap:** If **`LAMBDA_DOTENV_PATH`** is set in the real environment (shell or Cursor MCP **`env`**), MCP loads only that file. Otherwise it loads **`.env.local`** then **`.env`** from **`process.cwd()`** (local wins on duplicate keys). **`override: false`**, so the Cursor **`env`** block still wins where set. The **MCP setup** panel loads **`GET /api/mcp-setup-hints`** for readiness flags and a **`LAMBDA_WATCH_HTTP_URL`** derived from the current origin.

**Tools** (registered in [`src/mcp/tools/index.ts`](src/mcp/tools/index.ts); instance-scoped tools take `instance_id`)

| Tool | What it does |
|------|----------------|
| `get_status` (readonly) | Lambda instances plus MCP `setup` snapshot (env + command hints). Optional `instance_id` runs **`MCP_TRAINING_STATUS_COMMAND`** over SSH and returns cost tracking. Optional `include_log_tails` tails **`MCP_TRAINING_LOG_PATH`** (or `log_path`) on up to five instances (or up to ten when `instance_ids_for_tails` is set). Watch/snipe JSON is **not** included — use `get_ui_settings`. [`get-status.ts`](src/mcp/tools/get-status.ts). |
| `get_ui_settings` (readonly) | Watch/snipe config from **`LAMBDA_WATCH_HTTP_URL`** (capacity alerts, snipe prefs, derived list of GPU types with snipe enabled). [`get-ui-settings.ts`](src/mcp/tools/get-ui-settings.ts). |
| `setup_training_environment` (destructive) | SSH-runs **`MCP_ENV_SETUP_COMMAND`** (or `command` override) on `instance_id`. [`setup-training-environment.ts`](src/mcp/tools/setup-training-environment.ts). |
| `start_run` (destructive) | SSH-runs **`MCP_TRAINING_START_COMMAND`** (or `command` override). Optional `parameters` / `env` and `{{placeholder}}` expansion via [`command-template.ts`](src/mcp/command-template.ts). [`start-run.ts`](src/mcp/tools/start-run.ts). |
| `stop_training` (destructive) | Either **`strategy: run_command`** ( **`MCP_TRAINING_STOP_COMMAND`** or override) or **`strategy: send_signal`** (SIGINT/SIGTERM via PID file or `pgrep` pattern). [`stop-training.ts`](src/mcp/tools/stop-training.ts). |
| `tail_logs` (readonly) | `tail -n` on **`MCP_TRAINING_LOG_PATH`** (or `path`); full log text in `result`. Optional `include_interpretation` (default true) adds OOM/CUDA/NCCL-style hints. [`tail-logs.ts`](src/mcp/tools/tail-logs.ts). |
| `read_file` (readonly) | Read a remote file over SSH with a `max_bytes` cap (default 256 KiB). [`read-file.ts`](src/mcp/tools/read-file.ts). |
| `edit_file` (destructive) | Writes UTF-8 `content` to `path` on `instance_id` via base64 transfer (binary-safe, `mkdir -p` parents). [`edit-file.ts`](src/mcp/tools/edit-file.ts). |
| `ssh_exec` (destructive) | Run arbitrary remote shell (`bash -lc`) on `instance_id`. [`ssh-exec.ts`](src/mcp/tools/ssh-exec.ts). |
| `terminate_instance` (destructive) | Lambda HTTP terminate for `instance_id` (same API as the UI). [`terminate-instance.ts`](src/mcp/tools/terminate-instance.ts). |

**SSH** is used by every destructive tool except **`terminate_instance`** (HTTP only). **`get_ui_settings`** uses HTTP to your Next app, not SSH. MCP connects as `ubuntu` (or **`LAMBDA_SSH_USER`**) using **`LAMBDA_SSH_PEM_PATH`** and pipes `bash -lc <script>` over the wire. There is **no command whitelist**; **`ssh_exec`**, **`stop_training`** (`run_command`), **`start_run`**, **`setup_training_environment`**, and **`edit_file`** accept free-form shell. Any agent with MCP access can run arbitrary shell on instances or terminate them via the API. Use only with trusted agents. Optional `MCP_*` hint vars are documented in [`docs/mcp-ssh-training-hints.md`](docs/mcp-ssh-training-hints.md).

### MCP SSH configuration

- `LAMBDA_SSH_PEM_PATH` is required so MCP can authenticate over SSH.
- `LAMBDA_SSH_USER` (default `ubuntu`), `LAMBDA_SSH_PORT` (default `22`), `LAMBDA_SSH_TIMEOUT_MS` (default `120000`) tune connection behavior.
- `LAMBDA_SSH_DISABLE_HOST_KEY_CHECKING` defaults to `true` unless explicitly set to `false`.
- Optional command hints (in `get_status.setup`; used as defaults when tools omit overrides): `MCP_ENV_SETUP_COMMAND`, `MCP_TRAINING_START_COMMAND`, `MCP_TRAINING_STOP_COMMAND`, `MCP_TRAINING_STATUS_COMMAND`, `MCP_TRAINING_LOG_PATH`.

The MCP process **does not read** `LAMBDA_WATCH_CONFIG_PATH` on disk; it loads watch/snipe **only** by **GET**ting **`LAMBDA_WATCH_HTTP_URL`** (for example `http://127.0.0.1:3000/api/watch-config` while the Next app is running). [`GET /api/watch-config`](src/app/api/watch-config/route.ts) serves data from that JSON file on the server. Point **`LAMBDA_WATCH_HTTP_URL`** at that route.

**`x-lambda-watch-sync-secret`:** MCP sends this header when **`LAMBDA_WATCH_HTTP_SYNC_SECRET`** is set; otherwise it uses **`LAMBDA_WATCH_CONFIG_SYNC_SECRET`**.

**Keeping file and UI in sync:** In **`next dev`** the server writes **`.lambda/watch-config.json`** unless **`LAMBDA_WATCH_CONFIG_PATH`** is set explicitly. **`next start`/production:** set **`LAMBDA_WATCH_CONFIG_PATH`** so the path is writable. The UI debounces writes (~450ms after alert/snipe changes) via **POST** [`/api/watch-config`](src/app/api/watch-config/route.ts), updating the same file GET serves (including empty defaults when missing). Allowed in **development** or **`LAMBDA_WATCH_ALLOW_SYNC=true`**; **`LAMBDA_WATCH_CONFIG_SYNC_SECRET`** plus **`NEXT_PUBLIC_LAMBDA_WATCH_SYNC_SECRET`** can lock down access.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Dev server (`next dev`) |
| `npm run build` | Production build |
| `npm run start` | Production server (after `build`) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (`vitest run`; launch + Poke flow in [`poke-notify-flow.test.ts`](src/app/api/lambda/launch/poke-notify-flow.test.ts). [`vitest.config.ts`](vitest.config.ts) merges **`loadEnv`** for **development** and **test** so **`.env` / `.env.local`** apply. The live Poke test **fails with the response body** if Poke returns non-2xx or JSON without `success: true`; a passing test only means the **API** accepted the message (check the Poke app / conversation if the UI is empty). |
| `npm run mcp` | Stdio MCP server (`LAMBDA_API_KEY` required; `LAMBDA_SSH_PEM_PATH` required for SSH tools; **`LAMBDA_WATCH_HTTP_URL`** while the app is up for `get_ui_settings`) |
