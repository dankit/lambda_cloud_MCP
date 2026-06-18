import { spawn } from "node:child_process";
import { resolvePemPath } from "./credentials";
import { buildExportPrefix, shellSingleQuoteValue } from "../mcp/command-template";
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
    env: "MCP_TRAINING_STOP_COMMAND",
    id: "training_stop",
    summary:
      "Suggested shell snippet to stop a training job (documentation only).",
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

type SshConnection = {
  pem: string;
  user: string;
  port: number;
  disableHostKeyChecking: boolean;
};

function resolveSshConnection(): SshConnection {
  const pem = resolvePemPath(null).path;
  if (!pem) {
    throw new Error(
      "LAMBDA_SSH_PEM_PATH is not set. Configure it where the MCP server runs."
    );
  }
  return {
    pem,
    user: process.env.LAMBDA_SSH_USER?.trim() || "ubuntu",
    port: parsePort(process.env.LAMBDA_SSH_PORT),
    disableHostKeyChecking:
      process.env.LAMBDA_SSH_DISABLE_HOST_KEY_CHECKING?.trim() !== "false",
  };
}

/** Host-key flags shared by ssh and scp (the port flag differs: ssh -p, scp -P). */
function hostKeyArgs(disableHostKeyChecking: boolean): string[] {
  if (!disableHostKeyChecking) return [];
  return [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
  ];
}

/**
 * Compose the remote bash script: optional `export K='v' && …` prefix, then an
 * optional `cd '<workdir>' &&`, then the validated user command. Replaying cd/env
 * each call gives logical session continuity without a live shell (ControlMaster
 * is unreliable on the Windows host this server targets).
 */
function composeRemoteScript(params: {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
}): string {
  const exportPrefix = params.env ? buildExportPrefix(params.env) : "";
  const cdPrefix =
    params.workdir && params.workdir.trim().length > 0
      ? `cd ${shellSingleQuoteValue(params.workdir)} && `
      : "";
  return exportPrefix + cdPrefix + params.command;
}

export async function runSshShell(params: {
  host: string;
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<SshRunResult> {
  const script = sshExecCommandSchema.parse(params.command);
  const { pem, user, port, disableHostKeyChecking } = resolveSshConnection();
  const timeoutMs =
    params.timeoutMs && Number.isInteger(params.timeoutMs)
      ? params.timeoutMs
      : parseTimeoutMs(process.env.LAMBDA_SSH_TIMEOUT_MS);
  const remoteScript = composeRemoteScript({
    command: script,
    workdir: params.workdir,
    env: params.env,
  });
  const sshArgs = [
    "-i",
    pem,
    "-p",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    ...hostKeyArgs(disableHostKeyChecking),
    `${user}@${params.host}`,
    "bash",
    "-lc",
    remoteScript,
  ];

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
        command: remoteScript,
        host: params.host,
        user,
        port,
      });
    });
  });
}

export type ScpDirection = "upload" | "download";

export type ScpRunResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  direction: ScpDirection;
  localPath: string;
  remotePath: string;
  recursive: boolean;
  host: string;
  user: string;
  port: number;
};

/**
 * Copy files between the MCP host and a Lambda instance with scp, reusing the
 * same key and host-key policy as runSshShell. scp takes the port as `-P`.
 */
export async function runScp(params: {
  host: string;
  direction: ScpDirection;
  localPath: string;
  remotePath: string;
  recursive?: boolean;
  timeoutMs?: number;
}): Promise<ScpRunResult> {
  const { pem, user, port, disableHostKeyChecking } = resolveSshConnection();
  const timeoutMs =
    params.timeoutMs && Number.isInteger(params.timeoutMs)
      ? params.timeoutMs
      : parseTimeoutMs(process.env.LAMBDA_SSH_TIMEOUT_MS);
  const recursive = params.recursive === true;
  const remoteSpec = `${user}@${params.host}:${params.remotePath}`;
  const scpArgs = [
    "-i",
    pem,
    "-P",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    ...hostKeyArgs(disableHostKeyChecking),
  ];
  if (recursive) scpArgs.push("-r");
  if (params.direction === "upload") {
    scpArgs.push(params.localPath, remoteSpec);
  } else {
    scpArgs.push(remoteSpec, params.localPath);
  }

  const started = Date.now();
  return await new Promise<ScpRunResult>((resolve, reject) => {
    const child = spawn("scp", scpArgs, {
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
        direction: params.direction,
        localPath: params.localPath,
        remotePath: params.remotePath,
        recursive,
        host: params.host,
        user,
        port,
      });
    });
  });
}
