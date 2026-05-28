import { spawn } from "node:child_process";
import { resolvePemPath } from "./credentials";
import * as z from "zod";

const MAX_CAPTURE_BYTES = 1024 * 256;
/** Remote script length cap for ssh_exec (not a security boundary). */
export const MAX_SSH_COMMAND_CHARS = 32_768;

export const sshExecCommandSchema = z
  .string()
  .min(1, "command must not be empty")
  .max(MAX_SSH_COMMAND_CHARS)
  .refine((s) => !s.includes("\0"), "command must not contain NUL bytes");

const HINT_KEYS = [
  {
    env: "MCP_ENV_SETUP_COMMAND",
    id: "env_setup",
    summary: "Suggested shell snippet for environment setup (documentation only).",
  },
  {
    env: "MCP_TRAINING_START_COMMAND",
    id: "training_start",
    summary:
      "Suggested shell snippet to start a training job (documentation only).",
  },
  {
    env: "MCP_TRAINING_STATUS_COMMAND",
    id: "training_status",
    summary:
      "Suggested shell snippet to check training status (documentation only).",
  },
  {
    env: "MCP_TRAINING_LOG_PATH",
    id: "training_log_path",
    summary:
      "Typical training log path on the instance for tail/grep (documentation only).",
  },
] as const;

export type TrainingEnvironmentHint = {
  id: string;
  summary: string;
  value: string;
};

export function listTrainingEnvironmentHints(): TrainingEnvironmentHint[] {
  const hints: TrainingEnvironmentHint[] = [];
  for (const { env, id, summary } of HINT_KEYS) {
    const raw = process.env[env]?.trim();
    if (raw) hints.push({ id, summary, value: raw });
  }
  return hints;
}

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
