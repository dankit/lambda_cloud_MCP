import { spawn } from "node:child_process";
import { resolvePemPath } from "./credentials";
import * as z from "zod";

const MAX_CAPTURE_BYTES = 1024 * 256;
/** Remote script length cap for lambda_ssh_exec (not a security boundary). */
export const MAX_SSH_COMMAND_CHARS = 32_768;

export const sshExecCommandSchema = z
  .string()
  .min(1, "command must not be empty")
  .max(MAX_SSH_COMMAND_CHARS)
  .refine((s) => !s.includes("\0"), "command must not contain NUL bytes");

const TRAINING_COMMANDS_JSON_ENV = "MCP_TRAINING_COMMANDS_JSON";
const LEGACY_TRAINING_COMMAND_ENVS = [
  { env: "MCP_ENV_SETUP_COMMAND", field: "setup" },
  { env: "MCP_TRAINING_START_COMMAND", field: "start" },
  { env: "MCP_TRAINING_STOP_COMMAND", field: "stop" },
  { env: "MCP_TRAINING_STATUS_COMMAND", field: "status" },
  { env: "MCP_TRAINING_LOG_PATH", field: "logPath" },
] as const;

export type TrainingCommandsConfig = {
  setup: string | null;
  start: string | null;
  stop: string | null;
  status: string | null;
  logPath: string | null;
  source: "json" | "legacy";
  rawJson: string | null;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLegacyTrainingCommands(): Omit<TrainingCommandsConfig, "source" | "rawJson"> {
  const result = {
    setup: null as string | null,
    start: null as string | null,
    stop: null as string | null,
    status: null as string | null,
    logPath: null as string | null,
  };
  for (const { env, field } of LEGACY_TRAINING_COMMAND_ENVS) {
    const value = normalizeString(process.env[env]);
    if (value) {
      result[field] = value;
    }
  }
  return result;
}

function parseTrainingCommandsJson(raw: string): Omit<TrainingCommandsConfig, "source" | "rawJson"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "MCP_TRAINING_COMMANDS_JSON must be valid JSON with setup, start, stop, status, and logPath fields."
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "MCP_TRAINING_COMMANDS_JSON must be a JSON object with setup, start, stop, status, and logPath fields."
    );
  }
  const record = parsed as Record<string, unknown>;
  return {
    setup: normalizeString(record.setup),
    start: normalizeString(record.start),
    stop: normalizeString(record.stop),
    status: normalizeString(record.status),
    logPath: normalizeString(record.logPath ?? record.log_path),
  };
}

export function readTrainingCommandsConfig(): TrainingCommandsConfig {
  const rawJson = normalizeString(process.env[TRAINING_COMMANDS_JSON_ENV]);
  if (rawJson) {
    return {
      ...parseTrainingCommandsJson(rawJson),
      source: "json",
      rawJson,
    };
  }
  return {
    ...readLegacyTrainingCommands(),
    source: "legacy",
    rawJson: null,
  };
}

export function readTrainingCommand(
  field: keyof Omit<TrainingCommandsConfig, "source" | "rawJson">
): string | null {
  return readTrainingCommandsConfig()[field];
}

export function listTrainingEnvironmentHints(): TrainingEnvironmentHint[] {
  const config = readTrainingCommandsConfig();
  if (config.source === "json" && config.rawJson) {
    return [
      {
        id: "training_commands_json",
        summary:
          "Preferred single JSON config for setup/start/stop/status/logPath (documentation only).",
        value: config.rawJson,
      },
    ];
  }
  const legacy = readLegacyTrainingCommands();
  if (!legacy.setup && !legacy.start && !legacy.stop && !legacy.status && !legacy.logPath) {
    return [];
  }
  return [
    {
      id: "training_commands_legacy",
      summary:
        "Legacy per-command training values (backward compatible); prefer MCP_TRAINING_COMMANDS_JSON.",
      value: JSON.stringify(legacy, null, 2),
    },
  ];
}

function parsePort(raw: string | undefined): number {
function parsePort(raw: string | undefined): number {
  const fallback = 22;
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error("LAMBDA_SSH_PORT must be an integer between 1 and 65535.");
  }
  return n;
}

function parseTimeoutMs(raw: string | undefined): number {
  const fallback = 120_000;
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1_000 || n > 900_000) {
    throw new Error(
      "LAMBDA_SSH_TIMEOUT_MS must be an integer between 1000 and 900000."
    );
  }
  return n;
}

export type SshRunResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  command: string;
  host: string;
  user: string;
  port: number;
};

export async function runSshShell(params: {
  host: string;
  command: string;
}): Promise<SshRunResult> {
  const script = sshExecCommandSchema.parse(params.command);
  const pem = resolvePemPath(null).path;
  if (!pem) {
    throw new Error(
      "LAMBDA_SSH_PEM_PATH is not set. Configure it where the MCP server runs."
    );
  }
  const user = process.env.LAMBDA_SSH_USER?.trim() || "ubuntu";
  const port = parsePort(process.env.LAMBDA_SSH_PORT);
  const timeoutMs = parseTimeoutMs(process.env.LAMBDA_SSH_TIMEOUT_MS);
  const disableHostKeyChecking =
    process.env.LAMBDA_SSH_DISABLE_HOST_KEY_CHECKING?.trim() !== "false";
  const sshArgs = [
    "-i",
    pem,
    "-p",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
  ];
  if (disableHostKeyChecking) {
    sshArgs.push(
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null"
    );
  }
  sshArgs.push(`${user}@${params.host}`, "bash", "-lc", script);

  const started = Date.now();
  return await new Promise<SshRunResult>((resolve, reject) => {
    const child = spawn("ssh", sshArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let collected = 0;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const appendWithCap = (chunk: string, target: "stdout" | "stderr") => {
      if (collected >= MAX_CAPTURE_BYTES) {
        truncated = true;
        return;
      }
      const remaining = MAX_CAPTURE_BYTES - collected;
      const clipped = chunk.slice(0, remaining);
      collected += clipped.length;
      if (chunk.length > clipped.length) truncated = true;
      if (target === "stdout") stdout += clipped;
      else stderr += clipped;
    };

    child.stdout.on("data", (buf: Buffer) => {
      appendWithCap(buf.toString("utf8"), "stdout");
    });
    child.stderr.on("data", (buf: Buffer) => {
      appendWithCap(buf.toString("utf8"), "stderr");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && exitCode === 0,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        truncated,
        command: script,
        host: params.host,
        user,
        port,
      });
    });
  });
}
