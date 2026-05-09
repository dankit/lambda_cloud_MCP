# Lambda GPU availability checker and sniper

My biggest blocker over the past few months was always GPU availability. Lambda is my favorite platform because it has much less friction compared to major cloud providers like GCP. But even then, certain GPUs are in high demand and I'm tired of manually refreshing the page to check for capacity.

This application comes with two neat features:

View available gpus in near realtime. Launch and terminate gpus from within the same window.
![Proof of concept](PoC.png)

Create targeted alerts on desired gpus with the ability to snipe GPUs immediately after they first become available. Includes targeted region capabilities like "Any Region", high-level regions like "Us-East", or even more granular zones within a region such as "us-east-1". When desired gpus become available, the triggered alerts create a blinking visual highlight effect and the page emits a beeping noise.
![Proof of concept 2](PoC2.png)


Next.js 16 app: poll [Lambda Cloud](https://docs-api.lambda.ai/api/cloud) GPU capacity, launch instances, list/terminate runners, optional capacity **alerts** + **Snipe** (auto-launch), and a suggested `ssh -i` using your `.pem`. API calls go through this app’s server routes; the key stays off the client bundle.

**Prerequisites:** Node 20+, [API key](https://cloud.lambda.ai/api-keys), an SSH public key registered in Lambda, and a local `.pem` matching it (for the displayed SSH command only).

## Setup

1. Copy [`.env.example`](.env.example) to `.env.local` or `.env` in the project root.
2. Set `LAMBDA_API_KEY` (required for server-side Lambda calls). Set `LAMBDA_SSH_PEM_PATH` if you want the suggested SSH path filled in (not sent to Lambda).
3. `npm install` then `npm run dev` → [http://localhost:3000](http://localhost:3000). On Windows you can run [`dev.cmd`](dev.cmd) instead.

Optional overrides for the current session: API key and PEM path in **Settings** (sent only to this app’s APIs).

## Behavior

- **Capacity poll:** default **5s**, minimum **2s** in Settings. Ease off if you hit rate limits (~1 req/s account-wide is a rough guide).
- **Pause:** fast capacity polling stops while you have any running instance or a launch is in flight. If you have at least one alert configured, capacity still refreshes on a **45s** interval so alerts/Snipe can see stock appear.
- **Instances:** `GET /instances` every **15s**. Same API key in env or Settings → running machines still show after reload.
- **Refresh now** in Settings forces an immediate capacity fetch when you need it.
- **Alerts:** after the first successful instance-types load, **Setup alerts** picks watched GPU types (localStorage), optional **watch region**, rows pinned to the top. Capacity in scope → row flashes + repeating beep until that scope shows no capacity; most browsers need a **click anywhere** first (or **Test alert** on its button).
- **Snipe:** auto-launch when watched capacity **newly** appears, only with **no** running instances and not during launch/cooldown; **~12s** between launch attempts. Region/SSH key come from the alert panel (SSH key can default to the first key in the account).
- **After Snipe:** if the beep keeps going (e.g. API still reports capacity), **Remove alert** or **uncheck** the type in the catalog to stop watching and silence the alarm.
- **SSH hint:** default `ubuntu` @ port `22`; adjust if your image differs.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Dev server (`next dev`) |
| `npm run build` | Production build |
| `npm run start` | Production server (after `build`) |
| `npm run lint` | ESLint |
| `npm run mcp` | Stdio MCP server (`LAMBDA_API_KEY` required; optional watch/snipe via `LAMBDA_WATCH_HTTP_URL` or `LAMBDA_WATCH_CONFIG_PATH`) |

## MCP tooling

[`GET /api/watch-config`](src/app/api/watch-config/route.ts) returns the same `capacityAlerts` / `snipePrefs` snapshot as POST writes to `LAMBDA_WATCH_CONFIG_PATH`, using identical auth (**development**, or `LAMBDA_WATCH_ALLOW_SYNC=true`, optional `LAMBDA_WATCH_CONFIG_SYNC_SECRET` header). **`npm run mcp`** resolves watch config from **`LAMBDA_WATCH_HTTP_URL`** first when set (e.g. `http://127.0.0.1:3000/api/watch-config` while `npm run dev` is up), otherwise from the JSON file path. MCP sends **`x-lambda-watch-sync-secret`** using `LAMBDA_WATCH_HTTP_SYNC_SECRET` when set, else `LAMBDA_WATCH_CONFIG_SYNC_SECRET`.
