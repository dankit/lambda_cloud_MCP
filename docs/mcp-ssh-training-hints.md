# MCP SSH: training and environment hints

MCP exposes SSH so an agent can run **any** remote shell script on a Lambda instance via the **`ssh_exec`** tool (or the higher-level training tools). There is **no command whitelist**.

Optional env vars populate **`get_status`** → `setup.commandHints` (and `listTrainingEnvironmentHints` in code), which returns **documentation only**: snippets your project suggests. MCP does **not** validate those values through a separate hints-only tool; agents use **`get_status`** / **`get_ui_settings`** for context, then call tools with real commands.

## Suggested flow

1. Call **`get_status`** (and **`get_ui_settings`** for snipe/alerts) to read configured hints and instance state.
2. Use **`setup_training_environment`**, **`start_run`**, **`stop_training`**, **`tail_logs`**, **`read_file`**, **`edit_file`**, or **`ssh_exec`** with `instance_id` and the appropriate payload.

## Optional hint env vars

Set any subset; unset keys are omitted from the hints response.

| Env var                       | Hint id             | Purpose                                      |
| ----------------------------- | ------------------- | -------------------------------------------- |
| `MCP_ENV_SETUP_COMMAND`       | `env_setup`         | Suggested shell for environment setup        |
| `MCP_TRAINING_START_COMMAND`  | `training_start`    | Suggested shell to start training            |
| `MCP_TRAINING_STOP_COMMAND`   | _(used by stop_training run_command)_ | Suggested shell to stop training |
| `MCP_TRAINING_STATUS_COMMAND` | `training_status`   | Suggested shell to check training status     |
| `MCP_TRAINING_LOG_PATH`       | `training_log_path` | Typical training log path on the instance    |

## Safety

- **`ssh_exec`** and **`stop_training`** (`run_command`) run arbitrary remote commands using the PEM configured for MCP. A mistaken or malicious agent can damage data or the instance. Use only with trusted models and operators.
- Captured stdout/stderr are **bounded** and long-running commands may **time out** (see `LAMBDA_SSH_TIMEOUT_MS` in `.env.example` and README).
