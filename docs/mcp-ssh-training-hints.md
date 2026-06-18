# MCP SSH: training and environment hints

MCP exposes SSH so an agent can run **any** remote shell script on a Lambda instance via the **`ssh_exec`** tool. There is **no command whitelist** and no per-command wrapper tool — anything you could type in an SSH session (`tail`, `cat`, `kill`, `pip install`, launching training) is just `ssh_exec`.

Optional env vars populate **`get_status`** → `setup.commandHints` (and `listTrainingEnvironmentHints` in code), which returns **documentation only**: snippets your project suggests. MCP does **not** execute them on its own; the agent reads the hints from `get_status`, then runs the real command with `ssh_exec`.

## Suggested flow

1. Call **`get_status`** (and **`get_ui_settings`** for snipe/alerts) to read configured hints and instance state.
2. Run setup/training with **`ssh_exec`** (`instance_id` + `command`). Use `workdir`/`env` to keep a working directory and exported variables across calls, and `parameters` to fill `{{name}}` placeholders in a hint command.
3. For long-running training, call `ssh_exec` with `background: true`; it returns a `jobId`. Poll or stop it with **`job_status`** (`status` / `logs` / `stop`). This lets the run outlive the per-command SSH timeout.
4. Move files with **`transfer_file`** (`write` inline content, or `upload`/`download` via scp).

## Optional hint env vars

Set any subset; unset keys are omitted from the hints response.

| Env var                       | Hint id             | Purpose                                      |
| ----------------------------- | ------------------- | -------------------------------------------- |
| `MCP_ENV_SETUP_COMMAND`       | `env_setup`         | Suggested shell for environment setup        |
| `MCP_TRAINING_START_COMMAND`  | `training_start`    | Suggested shell to start training            |
| `MCP_TRAINING_STOP_COMMAND`   | `training_stop`     | Suggested shell to stop training             |
| `MCP_TRAINING_STATUS_COMMAND` | `training_status`   | Suggested shell to check training status (also enables cost tracking in `get_status`) |
| `MCP_TRAINING_LOG_PATH`       | `training_log_path` | Typical training log path on the instance    |

## Safety

- **`ssh_exec`** (including background jobs) and **`transfer_file`** run arbitrary remote commands/paths using the PEM configured for MCP. A mistaken or malicious agent can damage data or the instance. Use only with trusted models and operators.
- Captured stdout/stderr are **bounded** and synchronous commands may **time out** (see `LAMBDA_SSH_TIMEOUT_MS` in `.env.example` and README). For anything long-running, use `ssh_exec` `background: true` + `job_status` so the job is not killed at the timeout.
