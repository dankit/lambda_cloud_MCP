# Lambda Cloud Orchestration UI + MCP

My biggest blocker over the past few months was GPU availability. Lambda is my favorite platform because it has much less friction to setup than hyperscalers like GCP, but popular GPUs still disappear fast, and I am tired of manually refreshing a tab. This repo automates the entire GPU provisioning process and provides post-provisioning handoff to agents via MCP. The MCP exposes Lambda Cloud instances over SSH, and commands are orchestrated by [Poke](https://poke.com/) so you can agentically set up ML environments and training jobs over text message — full agency and productivity from your phone.

You provision the GPU manually through the UI first (one instance at a time, as a guardrail against runaway cloud bills). Once a GPU is up, the agent can handle everything else on the machine: raw SSH commands, environment setup, starting/stopping training, terminating the instance, and more.

## Quickstart

**Prerequisites:** Node **20+**, a [Lambda API key](https://cloud.lambda.ai/api-keys), an SSH **public** key registered in Lambda, and a local **`.pem`** matching it.

```bash
npm install
npm run setup     # guided wizard: writes a validated .env.local
npm run dev       # starts the UI and the MCP server together
```

Then open [http://localhost:3000](http://localhost:3000).

If you chose the **Poke (HTTP)** transport in the wizard, connect Poke in another terminal:

```bash
npx poke@latest tunnel http://127.0.0.1:8080/mcp -n "Local dev mcp"
```

That's it. Only two values are required (your **API key** and **`.pem` path**); everything else has sensible defaults. The wizard prints the exact next steps for your chosen transport when it finishes.

> Prefer not to use the wizard? Copy [`.env.example`](.env.example) to `.env.local` and fill in the two required vars by hand. Full variable reference: [`docs/configuration.md`](docs/configuration.md).

### Using Cursor / an editor (stdio) instead of Poke

Pick the **Cursor / editor (stdio)** option in the wizard, then run `npm run dev:ui` (UI only) and point your editor's MCP config at `npm run mcp` in this folder. See [`docs/configuration.md`](docs/configuration.md) for details.

---

## Orchestration UI

A **Next.js 16** app that polls the [Lambda Cloud HTTP API](https://docs-api.lambda.ai/api/cloud) for GPU capacity, launches instances, lists and terminates runners, with optional capacity **alerts** and **Snipe** (auto-launch), and a suggested `ssh -i` using your `.pem`. Use it to operate visually and to configure what MCP later reads over HTTP.

![Alerts and Snipe](PoC2.png)

Set up alerts for desired GPUs. Optionally auto-provision them the moment they become available via **Snipe**. Region scopes include **Any Region**, high-level areas like **Us-East**, or a granular zone such as **`us-east-1`**.

![Capacity table](PoC.png)

See available GPUs in near-real-time with built-in safeguards against Lambda rate limits. When a watched GPU becomes available, rows flash and the page beeps. Launch and terminate from the same page.

All Lambda calls go through **this app's server routes**; the API key stays out of the client bundle. Optional per-session overrides for **API key** and **PEM path** live under **Settings** (sent only to this app's APIs; they do **not** apply to the MCP process).

### Behavior at a glance

- **Capacity poll:** default **5s**, minimum **2s** (Settings). Ease off if you hit rate limits (~1 req/s account-wide).
- **Pause:** fast polling stops while an instance runs or a launch is in flight. With at least one alert configured, capacity still refreshes every **45s** so alerts/Snipe can see new stock.
- **Alerts & Snipe:** watched types pin to the top; a flashing row + repeating beep fire when capacity appears in scope (sound needs a prior click anywhere, or use **Test alert**). Snipe auto-launches when watched capacity newly appears, only with no running instance and outside cooldown (~12s between attempts).
- **SSH hint:** default `ubuntu` @ port **22**; adjust if your image differs.

Watch/snipe sync between the UI and MCP, plus all tuning knobs, are documented in [`docs/configuration.md`](docs/configuration.md).

---

## MCP server

`npm run mcp` runs the server ([`src/mcp/server.ts`](src/mcp/server.ts)). On startup it validates that `LAMBDA_API_KEY` and `LAMBDA_SSH_PEM_PATH` are set and prints a clear message (pointing you at `npm run setup`) if anything is missing. With the HTTP transport, FastMCP logs the full URL (e.g. `http://127.0.0.1:8080/mcp`).

The surface is deliberately small: it exposes only what an agent **cannot** do over a raw SSH session it already understands (Lambda API calls, `instance_id`→host resolution, connection/PEM management, structured output, background-job bookkeeping). Routine shell work (`tail`, `cat`, `kill`, installing deps, starting training) is just `ssh_exec` — no per-command tool to bloat the context window.

**Tools** (registered in [`src/mcp/tools/index.ts`](src/mcp/tools/index.ts); instance-scoped tools take `instance_id`)

| Tool | What it does |
|------|----------------|
| `get_status` (readonly) | Lambda instances plus an MCP `setup` snapshot (env + command hints). Optional `instance_id` runs **`MCP_TRAINING_STATUS_COMMAND`** over SSH and returns cost tracking. [`get-status.ts`](src/mcp/tools/get-status.ts). |
| `get_ui_settings` (readonly) | Watch/snipe config from the UI (capacity alerts, snipe prefs, GPU types with snipe enabled). [`get-ui-settings.ts`](src/mcp/tools/get-ui-settings.ts). |
| `ssh_exec` (destructive) | Run a shell command (`bash -lc`) on `instance_id` with structured output. Optional `workdir`/`env` persist across calls (logical session continuity); `parameters` fill `{{name}}` placeholders via [`command-template.ts`](src/mcp/command-template.ts); `background: true` detaches a long job (returns a `jobId`) so it survives `LAMBDA_SSH_TIMEOUT_MS`. [`ssh-exec.ts`](src/mcp/tools/ssh-exec.ts). |
| `job_status` (destructive) | Inspect or stop a background job started by `ssh_exec`: `status`/`logs` (running, exit code, log tail, optional OOM/CUDA/NCCL interpretation) or `stop` (signal the job's process group). [`job-status.ts`](src/mcp/tools/job-status.ts). |
| `transfer_file` (destructive) | `write` inline UTF-8 content to a remote path (base64-safe), or `upload`/`download` files and directories via `scp`. [`transfer-file.ts`](src/mcp/tools/transfer-file.ts). |
| `terminate_instance` (destructive) | Lambda HTTP terminate for `instance_id`. [`terminate-instance.ts`](src/mcp/tools/terminate-instance.ts). |

Preset training commands (`MCP_ENV_SETUP_COMMAND`, `MCP_TRAINING_START_COMMAND`, `MCP_TRAINING_STOP_COMMAND`, `MCP_TRAINING_LOG_PATH`, …) are still surfaced as **hints** in `get_status.setup.commandHints`; the agent reads them, then runs them with `ssh_exec`.

### Security

Every tool except `terminate_instance` (HTTP only) uses SSH/scp. MCP connects as `ubuntu` (or `LAMBDA_SSH_USER`) using `LAMBDA_SSH_PEM_PATH` and pipes `bash -lc <script>` over the wire. **There is no command whitelist** — `ssh_exec`, background jobs, and `transfer_file` (`write`) accept free-form shell/paths. Any agent with MCP access can run arbitrary shell on instances or terminate them. **Use only with trusted agents.**

In HTTP mode, tools are **not authenticated** over the wire — keep the server on `127.0.0.1` and reach it through a tunnel; do not expose `0.0.0.0` on a public interface without your own controls.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run setup` | Guided setup wizard (writes `.env.local`) |
| `npm run dev` | UI + MCP together (primary, Poke/HTTP path) |
| `npm run dev:ui` | UI only (`next dev`) — for Cursor/stdio users |
| `npm run mcp` | MCP server only |
| `npm run build` | Production build |
| `npm run start` | Production server (after `build`) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |

Full configuration reference (transport, watch/snipe sync, SSH tuning, training hints, production deployment): [`docs/configuration.md`](docs/configuration.md).
