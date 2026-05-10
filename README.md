# Lambda Cloud Orchestration UI + MCP

My biggest blocker over the past few months was GPU availability. Lambda is my favorite platform because it has much less friction to setup than hyperscalers like GCP, but popular GPUs still disappear fast, and I am tired of manually refreshing a tab. This repo aims to not only automate the entire GPU provisioning process, but also provides post-provisioning handoff to agents via MCP. My main intention is to plug this MCP into [Poke](https://poke.com/), so I can agentically orchestrate everything via text message. This way I can step away from the computer and still handle everything from my phone. The MCP is still a work in progress but the UI should work as is.

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
3. For MCP + synced watch/snipe JSON: **`npm run dev`** auto-persists to **`.lambda/watch-config.json`** unless **`LAMBDA_WATCH_CONFIG_PATH`** overrides — no env var needed for that path in development. With the app open, use **MCP setup** on the home page for a derived **`LAMBDA_WATCH_HTTP_URL`** and a copy-paste env block. Alternative: set **`LAMBDA_WATCH_HTTP_URL`** yourself (example **`http://127.0.0.1:3000/api/watch-config`**). Explicit **`LAMBDA_WATCH_CONFIG_PATH`** is recommended for **`next start`/production.** Optional: **`LAMBDA_WATCH_CONFIG_SYNC_SECRET`**, **`NEXT_PUBLIC_LAMBDA_WATCH_SYNC_SECRET`**, **`LAMBDA_WATCH_HTTP_SYNC_SECRET`**, **`LAMBDA_WATCH_ALLOW_SYNC`**—see [`.env.example`](.env.example).
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

## MCP server (WIP)

Run **`npm run mcp`** ([`src/mcp/server.ts`](src/mcp/server.ts)). **`LAMBDA_API_KEY`** is required (environment of whatever launches MCP, optionally filled from **`LAMBDA_DOTENV_PATH`**).

**Dotenv bootstrap:** MCP loads **`LAMBDA_DOTENV_PATH`** relative to **`process.cwd()`** (default **`.env.local`** when unset) before tools run — **`override: false`**, so the Cursor MCP **`env`** block still wins where set. The **MCP setup** panel loads **`GET /api/mcp-setup-hints`** for readiness flags and a **`LAMBDA_WATCH_HTTP_URL`** derived from the current origin.

**Tools**

| Tool | What it does |
|------|----------------|
| `lambda_list_instances` | List Lambda scheduled instances (IDs, status, IPs, region, instance type); optional `cluster_id` query. |
| `lambda_get_watch_snipe_config` | Returns **`capacityAlerts`** and **`snipePrefs`** by fetching **`LAMBDA_WATCH_HTTP_URL`** over HTTP (see below). |
| `lambda_summarize_gpu_types` | Merges live instances with watch/snipe config into a per-GPU-type summary (watched region, Snipe on/off and SSH key name, matching instances). |
| `lambda_ssh_list_training_hints` | Returns optional `MCP_*` env snippets for training/environment setup. **Documentation only** — not validated or executed by this tool. |
| `lambda_ssh_exec` | Resolves `instance_id` to host/IP, SSHs from the MCP process, and runs the given remote script via `bash -lc`. **Arbitrary execution** — use only with trusted agents. |

SSH has **no command whitelist**. Optional hints are listed in [`docs/mcp-ssh-training-hints.md`](docs/mcp-ssh-training-hints.md).

### MCP SSH configuration

- `LAMBDA_SSH_PEM_PATH` is required so MCP can authenticate over SSH.
- `LAMBDA_SSH_USER` (default `ubuntu`), `LAMBDA_SSH_PORT` (default `22`), `LAMBDA_SSH_TIMEOUT_MS` (default `120000`) tune connection behavior.
- `LAMBDA_SSH_DISABLE_HOST_KEY_CHECKING` defaults to `true` unless explicitly set to `false`.
- Optional hints (surfaced only by `lambda_ssh_list_training_hints`, not required for SSH): `MCP_ENV_SETUP_COMMAND`, `MCP_TRAINING_START_COMMAND`, `MCP_TRAINING_STATUS_COMMAND`, `MCP_TRAINING_LOG_PATH`.

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
| `npm run mcp` | Stdio MCP server (`LAMBDA_API_KEY` required; watch/snipe via GET `LAMBDA_WATCH_HTTP_URL` while the app is up) |



todo
MCP_ENV_SETUP_COMMAND could be a bash script that auto clones a repo, need to ensure git credentials are already present on MCP
MCP_TRAINING_START_COMMAND are cli arguments that can be adjusted
MCP_TRAINING_STATUS_COMMAND could return shell history, might need to incorporate this with setup command to ensure things were setup

give poke access to target project repo (project being launched, not this one) to make changes and fix things