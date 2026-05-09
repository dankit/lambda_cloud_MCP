import { spawn } from "node:child_process";
import { resolvePemPath } from "./credentials";
import * as z from "zod";

const MAX_CAPTURE_BYTES = 1024 * 256;

const systemInfoArgsSchema = z.object({}).strict();
const processListArgsSchema = z
  .object({
    limit: z.number().int().min(5).max(200).optional(),
  })
  .strict();
const tailLogArgsSchema = z
  .object({
    target: z.enum(["training", "system"]),
    lines: z.number().int().min(10).max(400).optional(),
  })
  .strict();
const pythonVenvArgsSchema = z
  .object({
    python_bin: z.string().regex(/^[A-Za-z0-9._/-]{1,80}$/).optional(),
  })
  .strict();
const startTrainingArgsSchema = z
  .object({
    run_name: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .optional(),
  })
  .strict();
const trainingStatusArgsSchema = z.object({}).strict();

export const sshCommandCatalog = {
  system_info: {
    summary: "Basic host diagnostics (OS, uptime, disk, memory, GPUs).",
    argsSchema: systemInfoArgsSchema,
    argsJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  process_list: {
    summary: "Top processes by CPU usage.",
    argsSchema: processListArgsSchema,
    argsJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 5,
          maximum: 200,
          description: "Maximum rows returned (default 40).",
        },
      },
    },
  },
  tail_log: {
    summary: "Tail approved log files only (training/system).",
    argsSchema: tailLogArgsSchema,
    argsJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: {
          type: "string",
          enum: ["training", "system"],
        },
        lines: {
          type: "integer",
          minimum: 10,
          maximum: 400,
          description: "Lines to tail (default 120).",
        },
      },
      required: ["target"],
    },
  },
  python_venv_status: {
    summary: "Python/venv quick health check.",
    argsSchema: pythonVenvArgsSchema,
    argsJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        python_bin: {
          type: "string",
          description:
            "Optional python executable name/path; defaults to python3.",
        },
      },
    },
  },
  start_training_job: {
    summary: "Run project training start command from env.",
    argsSchema: startTrainingArgsSchema,
    argsJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_name: {
          type: "string",
          description:
            "Optional run name token (letters, digits, dot, underscore, dash).",
        },
      },
    },
  },
  training_status: {
    summary: "Run project training status command from env.",
    argsSchema: trainingStatusArgsSchema,
    argsJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
} as const;

export type AllowedSshCommandId = keyof typeof sshCommandCatalog;

function shellQuoteSingle(text: string): string {
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

function requireEnvText(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this command.`);
  }
  return value;
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

type ResolvedCommand =
  | { id: "system_info"; script: string }
  | { id: "process_list"; script: string }
  | { id: "tail_log"; script: string }
  | { id: "python_venv_status"; script: string }
  | { id: "start_training_job"; script: string }
  | { id: "training_status"; script: string };

export function resolveSshCommand(params: {
  commandId: AllowedSshCommandId;
  args: unknown;
}): ResolvedCommand {
  const { commandId } = params;
  if (commandId === "system_info") {
    sshCommandCatalog.system_info.argsSchema.parse(params.args ?? {});
    return {
      id: "system_info",
      script:
        "uname -a; uptime; nvidia-smi -L || true; df -h /; free -h || true",
    };
  }
  if (commandId === "process_list") {
    const parsed = sshCommandCatalog.process_list.argsSchema.parse(
      params.args ?? {}
    );
    const limit = parsed.limit ?? 40;
    return {
      id: "process_list",
      script: `ps -eo pid,pcpu,pmem,etime,args --sort=-pcpu | head -n ${limit}`,
    };
  }
  if (commandId === "tail_log") {
    const parsed = sshCommandCatalog.tail_log.argsSchema.parse(params.args ?? {});
    const lines = parsed.lines ?? 120;
    const trainingLogPath =
      process.env.MCP_TRAINING_LOG_PATH?.trim() ?? "~/training.log";
    const systemLogPath =
      process.env.MCP_SYSTEM_LOG_PATH?.trim() ?? "/var/log/syslog";
    const path = parsed.target === "training" ? trainingLogPath : systemLogPath;
    return {
      id: "tail_log",
      script: `tail -n ${lines} ${shellQuoteSingle(path)}`,
    };
  }
  if (commandId === "python_venv_status") {
    const parsed = sshCommandCatalog.python_venv_status.argsSchema.parse(
      params.args ?? {}
    );
    const pythonBin = parsed.python_bin ?? "python3";
    return {
      id: "python_venv_status",
      script: `${shellQuoteSingle(
        pythonBin
      )} --version; pip --version || true; [ -n "$VIRTUAL_ENV" ] && echo "VIRTUAL_ENV=$VIRTUAL_ENV" || echo "VIRTUAL_ENV not set"`,
    };
  }
  if (commandId === "start_training_job") {
    const parsed = sshCommandCatalog.start_training_job.argsSchema.parse(
      params.args ?? {}
    );
    const base = requireEnvText("MCP_TRAINING_START_COMMAND");
    const runArg = parsed.run_name ? ` --run-name ${parsed.run_name}` : "";
    return {
      id: "start_training_job",
      script: `${base}${runArg}`,
    };
  }
  const _exhaustive: "training_status" = commandId;
  sshCommandCatalog.training_status.argsSchema.parse(params.args ?? {});
  return {
    id: _exhaustive,
    script: requireEnvText("MCP_TRAINING_STATUS_COMMAND"),
  };
}

export function listAllowedSshCommands() {
  return Object.entries(sshCommandCatalog).map(([id, meta]) => ({
    id,
    summary: meta.summary,
    argsJsonSchema: meta.argsJsonSchema,
  }));
}

export type SshRunResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  commandId: AllowedSshCommandId;
  host: string;
  user: string;
  port: number;
};

export async function runAllowedSshCommand(params: {
  host: string;
  commandId: AllowedSshCommandId;
  args: unknown;
}): Promise<SshRunResult> {
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
  const resolved = resolveSshCommand({
    commandId: params.commandId,
    args: params.args,
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
  ];
  if (disableHostKeyChecking) {
    sshArgs.push(
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null"
    );
  }
  sshArgs.push(`${user}@${params.host}`, "bash", "-lc", resolved.script);

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
        commandId: params.commandId,
        host: params.host,
        user,
        port,
      });
    });
  });
}
