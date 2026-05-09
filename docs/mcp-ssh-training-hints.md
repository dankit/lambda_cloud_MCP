# MCP SSH: training and environment hints

MCP exposes SSH so an agent can run **any** remote shell script on a Lambda instance via `lambda_ssh_exec`. There is **no command whitelist**.

Optional env vars populate **`lambda_ssh_list_training_hints`**, which returns **documentation only**: snippets and paths your project suggests. MCP does **not** validate or execute those values through the hints tool; an agent composes real commands and passes them to `lambda_ssh_exec`.

## Suggested flow

1. Optionally call **`lambda_ssh_list_training_hints`** to read suggested setup/start/status/log paths from the environment.
2. Call **`lambda_ssh_exec`** with `instance_id` and `command` (a string passed to remote `bash -lc`).

## Optional hint env vars

Set any subset; unset keys are omitted from the hints response.

| Env var | Hint id | Purpose |
|--------|---------|--------|
| `MCP_ENV_SETUP_COMMAND` | `env_setup` | Suggested shell for environment setup |
| `MCP_TRAINING_START_COMMAND` | `training_start` | Suggested shell to start training |
| `MCP_TRAINING_STATUS_COMMAND` | `training_status` | Suggested shell to check training status |
| `MCP_TRAINING_LOG_PATH` | `training_log_path` | Typical training log path (for `tail`, etc.) |

## Safety

- **`lambda_ssh_exec` runs arbitrary remote commands** using the PEM configured for MCP. A mistaken or malicious agent can damage data or the instance. Use only with trusted models and operators.
- Captured stdout/stderr are **bounded** and long-running commands may **time out** (see `LAMBDA_SSH_TIMEOUT_MS` in `.env.example` and README).

## Breaking change

Older MCP tools `lambda_ssh_list_allowed_commands` and `lambda_ssh_run_allowed_command` were removed. Update client configs to use `lambda_ssh_list_training_hints` and `lambda_ssh_exec`.
