# MCP SSH Command Catalog

This project exposes SSH operations through MCP in **strict allowlist mode**.
Agents must use only the command IDs in this file.

## Required flow

1. Call `lambda_ssh_list_allowed_commands` to read current command definitions.
2. Call `lambda_ssh_run_allowed_command` with:
   - `instance_id`: Lambda instance ID.
   - `command_id`: one of the allowlisted IDs below.
   - `args`: command-specific object (or `{}` when no args are needed).

The MCP server resolves `instance_id` to host/IP and opens SSH itself.
Raw shell command execution is intentionally blocked.

## Allowlisted command IDs

### `system_info`
- Purpose: basic host diagnostics.
- Args: none (`{}`).
- Behavior: OS/kernel, uptime, GPU list, disk and memory snapshot.

### `process_list`
- Purpose: inspect active processes quickly.
- Args:
  - `limit` (optional integer, min `5`, max `200`, default `40`).
- Behavior: returns a CPU-sorted process table.

### `tail_log`
- Purpose: tail approved logs only.
- Args:
  - `target` (required enum): `training` or `system`.
  - `lines` (optional integer, min `10`, max `400`, default `120`).
- Behavior:
  - `training` reads `MCP_TRAINING_LOG_PATH` (default `~/training.log`).
  - `system` reads `MCP_SYSTEM_LOG_PATH` (default `/var/log/syslog`).

### `python_venv_status`
- Purpose: verify Python and virtualenv state.
- Args:
  - `python_bin` (optional string, safe token/path pattern).
- Behavior: prints Python version, pip version, and `VIRTUAL_ENV` status.

### `start_training_job`
- Purpose: launch a project training job from a predefined command.
- Args:
  - `run_name` (optional string token: letters/digits/`._-`, max 64 chars).
- Behavior:
  - Executes `MCP_TRAINING_START_COMMAND`.
  - Appends `--run-name <value>` when `run_name` is provided.

### `training_status`
- Purpose: check training health/status from a predefined command.
- Args: none (`{}`).
- Behavior: executes `MCP_TRAINING_STATUS_COMMAND`.

## Safety notes

- No freeform remote command input is accepted by MCP tools.
- Unknown `command_id` values are rejected.
- Args are validated before SSH runs.
- SSH output is bounded and may be truncated on very large logs.
