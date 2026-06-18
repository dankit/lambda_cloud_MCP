import path from "node:path";
import { existsSync } from "node:fs";
import { config as loadDotenvFromFile } from "dotenv";
import * as z from "zod";
import { envConfigSnapshot, resolveApiKey } from "../lib/credentials";
import { lambdaFetch } from "../lib/lambda";
import {
  listTrainingEnvironmentHints,
  runSshShell,
  type SshRunResult,
} from "../lib/mcp-ssh";
import {
  formatError,
  parseInstancesListPayload,
} from "../app/home/parsers";
import type { InstanceDetail } from "../app/home/types";

export function bootstrapMcpProcessEnv(): void {
  const raw = process.env.LAMBDA_DOTENV_PATH?.trim();
  const cwd = process.cwd();
  if (raw && raw.length > 0) {
    loadDotenvFromFile({
      path: path.resolve(cwd, raw),
      override: false,
      quiet: true,
    });
    return;
  }
  // No explicit path: load both (Next-style). `.env.local` first so it wins on duplicate keys;
  // `.env` fills gaps. `LAMBDA_DOTENV_PATH` inside `.env` cannot select the file — set it in
  // the shell or Cursor MCP env if you need a single custom path.
  loadDotenvFromFile({
    path: path.resolve(cwd, ".env.local"),
    override: false,
    quiet: true,
  });
  loadDotenvFromFile({
    path: path.resolve(cwd, ".env"),
    override: false,
    quiet: true,
  });
}

const mcpEnvSchema = z.object({
  LAMBDA_API_KEY: z
    .string()
    .trim()
    .min(1, "LAMBDA_API_KEY is required (your Lambda Cloud API key)."),
  LAMBDA_SSH_PEM_PATH: z
    .string()
    .trim()
    .min(1, "LAMBDA_SSH_PEM_PATH is required (absolute path to your .pem)."),
});

/**
 * Validate required env before the server starts so users get one clear,
 * actionable message instead of an opaque failure at the first tool call.
 * Logs to stderr (stdout is the stdio JSON-RPC stream) and exits on failure.
 */
export function preflightMcpEnv(): void {
  const result = mcpEnvSchema.safeParse({
    LAMBDA_API_KEY: process.env.LAMBDA_API_KEY,
    LAMBDA_SSH_PEM_PATH: process.env.LAMBDA_SSH_PEM_PATH,
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  • ${i.message}`).join("\n");
    console.error(
      [
        "",
        "[lambda-cloud-mcp] Missing required configuration:",
        issues,
        "",
        "Fix it by running the guided setup:  npm run setup",
        "…or set the variables in .env.local (see docs/configuration.md).",
        "",
      ].join("\n")
    );
    process.exit(1);
  }

  const pemPath = result.data.LAMBDA_SSH_PEM_PATH;
  if (!existsSync(pemPath)) {
    console.error(
      `[lambda-cloud-mcp] Warning: no .pem found at LAMBDA_SSH_PEM_PATH (${pemPath}). SSH tools will fail until it exists.`
    );
  }
}

export function requireApiKey(): string {
  const { key } = resolveApiKey(null);
  if (!key) {
    throw new Error(
      "LAMBDA_API_KEY is not set. Add it to .env or your MCP server env block."
    );
  }
  return key;
}

export function readCommandEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringField(
  obj: Record<string, unknown> | null,
  keys: string[]
): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readNumberField(
  obj: Record<string, unknown> | null,
  keys: string[]
): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function parseDurationText(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const hms = trimmed.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (hms) {
    const hours = Number(hms[1]);
    const minutes = Number(hms[2]);
    const seconds = Number(hms[3]);
    if ([hours, minutes, seconds].every(Number.isFinite)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  const ms = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (ms) {
    const minutes = Number(ms[1]);
    const seconds = Number(ms[2]);
    if ([minutes, seconds].every(Number.isFinite)) {
      return minutes * 60 + seconds;
    }
  }

  const compact = trimmed.match(
    /^(?:(\d+(?:\.\d+)?)\s*h)?(?:(\d+(?:\.\d+)?)\s*m)?(?:(\d+(?:\.\d+)?)\s*s)?$/
  );
  if (compact && (compact[1] || compact[2] || compact[3])) {
    const hours = compact[1] ? Number(compact[1]) : 0;
    const minutes = compact[2] ? Number(compact[2]) : 0;
    const seconds = compact[3] ? Number(compact[3]) : 0;
    if ([hours, minutes, seconds].every(Number.isFinite)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  return null;
}

function parseElapsedLikeValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;

  const duration = parseDurationText(trimmed);
  if (duration !== null) return duration;

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const seconds = Math.max(0, Math.floor((Date.now() - parsedDate) / 1000));
    return seconds;
  }

  return null;
}

function extractElapsedSeconds(
  parsedJson: unknown,
  rawInstance: Record<string, unknown> | null
): { elapsedSeconds: number | null; elapsedSource: string | null } {
  const remote = isRecord(parsedJson) ? parsedJson : null;
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: "remote.elapsed_seconds", value: remote?.elapsed_seconds },
    { source: "remote.uptime_seconds", value: remote?.uptime_seconds },
    { source: "remote.runtime_seconds", value: remote?.runtime_seconds },
    { source: "remote.duration_seconds", value: remote?.duration_seconds },
    { source: "remote.elapsed", value: remote?.elapsed },
    { source: "remote.started_at", value: remote?.started_at },
    { source: "remote.start_time", value: remote?.start_time },
    { source: "remote.launched_at", value: remote?.launched_at },
    { source: "instance.started_at", value: rawInstance?.started_at },
    { source: "instance.start_time", value: rawInstance?.start_time },
    { source: "instance.launched_at", value: rawInstance?.launched_at },
    { source: "instance.created_at", value: rawInstance?.created_at },
  ];

  for (const candidate of candidates) {
    const elapsedSeconds = parseElapsedLikeValue(candidate.value);
    if (elapsedSeconds !== null) {
      return { elapsedSeconds, elapsedSource: candidate.source };
    }
  }

  return { elapsedSeconds: null, elapsedSource: null };
}

function findRawInstanceRecord(
  raw: unknown,
  instanceId: string
): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const containers: unknown[] = [];
  if (Array.isArray(raw.data)) containers.push(...raw.data);
  if (isRecord(raw.data) && Array.isArray(raw.data.instances)) {
    containers.push(...raw.data.instances);
  }
  for (const item of containers) {
    if (isRecord(item) && item.id === instanceId) return item;
  }
  return null;
}

function extractHourlyRateUsd(
  rawInstance: Record<string, unknown> | null,
  parsedInstance: InstanceDetail
): { hourlyRateUsd: number | null; hourlyRateSource: string | null } {
  const nestedType = isRecord(rawInstance?.instance_type)
    ? (rawInstance?.instance_type as Record<string, unknown>)
    : null;
  const priceCentsPerHour =
    readNumberField(nestedType, ["price_cents_per_hour"]) ??
    readNumberField(rawInstance, ["price_cents_per_hour"]);
  if (priceCentsPerHour !== null) {
    return {
      hourlyRateUsd: priceCentsPerHour / 100,
      hourlyRateSource:
        nestedType?.price_cents_per_hour !== undefined
          ? "instance.instance_type.price_cents_per_hour"
          : "instance.price_cents_per_hour",
    };
  }
  if (parsedInstance.instance_type_name) {
    return { hourlyRateUsd: null, hourlyRateSource: null };
  }
  return { hourlyRateUsd: null, hourlyRateSource: null };
}

function extractInstanceMeta(
  rawInstance: Record<string, unknown> | null,
  parsedInstance: InstanceDetail
): {
  instanceTypeName: string | null;
  status: string | null;
  createdAt: string | null;
  launchedAt: string | null;
  startedAt: string | null;
  hourlyRateUsd: number | null;
  hourlyRateSource: string | null;
} {
  const nestedType = isRecord(rawInstance?.instance_type)
    ? (rawInstance?.instance_type as Record<string, unknown>)
    : null;
  const instanceTypeName =
    readStringField(nestedType, ["name"]) ?? parsedInstance.instance_type_name ?? null;
  const status = readStringField(rawInstance, ["status"]) ?? parsedInstance.status ?? null;
  const createdAt = readStringField(rawInstance, ["created_at"]);
  const launchedAt = readStringField(rawInstance, ["launched_at"]);
  const startedAt = readStringField(rawInstance, ["started_at"]);
  const rate = extractHourlyRateUsd(rawInstance, parsedInstance);
  return {
    instanceTypeName,
    status,
    createdAt,
    launchedAt,
    startedAt,
    hourlyRateUsd: rate.hourlyRateUsd,
    hourlyRateSource: rate.hourlyRateSource,
  };
}

export function parseMaybeJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function estimateCostUsd(
  hourlyRateUsd: number | null,
  elapsedSeconds: number | null
): number | null {
  if (hourlyRateUsd === null || elapsedSeconds === null) return null;
  const value = (hourlyRateUsd * elapsedSeconds) / 3600;
  return Number(value.toFixed(6));
}

export function getSetupSnapshot() {
  return {
    environment: envConfigSnapshot(),
    commandHints: listTrainingEnvironmentHints(),
    configuredCommands: {
      setupTrainingEnvironment: readCommandEnv("MCP_ENV_SETUP_COMMAND"),
      startRun: readCommandEnv("MCP_TRAINING_START_COMMAND"),
      stopTraining: readCommandEnv("MCP_TRAINING_STOP_COMMAND"),
      getStatus: readCommandEnv("MCP_TRAINING_STATUS_COMMAND"),
      logTail: readCommandEnv("MCP_TRAINING_LOG_PATH"),
    },
  };
}

export async function terminateLambdaInstance(instanceId: string) {
  const apiKey = requireApiKey();
  const { ok, status, body } = await lambdaFetch("/instance-operations/terminate", {
    method: "POST",
    apiKey,
    body: { instance_ids: [instanceId] },
  });
  return {
    ok,
    instanceId,
    httpStatus: status,
    body,
    message: ok ? null : formatError(body ?? {}),
  };
}

export async function fetchInstances(clusterId?: string) {
  const apiKey = requireApiKey();
  const apiPath =
    clusterId === undefined || clusterId === ""
      ? "/instances"
      : "/instances?cluster_id=" + encodeURIComponent(clusterId);
  const { ok, status, body } = await lambdaFetch(apiPath, { apiKey });
  if (!ok) {
    return {
      ok: false as const,
      status,
      message: formatError(body ?? {}),
      body,
    };
  }
  return {
    ok: true as const,
    instances: parseInstancesListPayload(body ?? {}) as InstanceDetail[],
    raw: body,
  };
}

export async function resolveInstanceHostById(instanceId: string) {
  const result = await fetchInstances(undefined);
  if (!result.ok) {
    return {
      ok: false as const,
      message: result.message,
      httpStatus: result.status,
    };
  }
  const match = result.instances.find((instance) => instance.id === instanceId);
  if (!match) {
    return {
      ok: false as const,
      message: "Instance " + instanceId + " was not found.",
      httpStatus: 404,
    };
  }
  const host = match.ip?.trim() || match.hostname?.trim() || "";
  if (!host) {
    return {
      ok: false as const,
      message:
        "Instance " + instanceId + " has no public host to SSH into." +
        " Wait for networking to come up and retry.",
      httpStatus: 409,
    };
  }
  return {
    ok: true as const,
    host,
    instance: match,
  };
}

export async function runCommandOnInstance(params: {
  instanceId: string;
  command: string;
}) {
  const hostResult = await resolveInstanceHostById(params.instanceId);
  if (!hostResult.ok) {
    return {
      ok: false as const,
      instanceId: params.instanceId,
      message: hostResult.message,
      httpStatus: hostResult.httpStatus,
    };
  }
  const run: SshRunResult = await runSshShell({
    host: hostResult.host,
    command: params.command,
  });
  return {
    ok: run.ok,
    instanceId: params.instanceId,
    command: run.command,
    host: run.host,
    user: run.user,
    port: run.port,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    timedOut: run.timedOut,
    truncated: run.truncated,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

export type RemoteRunStatus = {
  ok: boolean;
  instanceId: string;
  command?: string;
  host?: string;
  user?: string;
  port?: number;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
  truncated?: boolean;
  stdout?: string;
  stderr?: string;
  message?: string;
  httpStatus?: number;
  parsedJson?: unknown | null;
  parsedJsonType?: string | null;
};

export type RunCostTracking = {
  hourlyRateUsd: number | null;
  hourlyRateSource: string | null;
  elapsedSeconds: number | null;
  elapsedSource: string | null;
  estimatedCostUsd: number | null;
  ratePerSecondUsd: number | null;
};

export type RunObservation =
  | {
      ok: true;
      tool: "run_status";
      instanceId: string;
      instance: InstanceDetail;
      instanceMeta: {
        instanceTypeName: string | null;
        status: string | null;
        createdAt: string | null;
        launchedAt: string | null;
        startedAt: string | null;
        hourlyRateUsd: number | null;
        hourlyRateSource: string | null;
      };
      runState: string | null;
      statusCommand: string | null;
      remoteStatus: RemoteRunStatus | null;
      logPath: string | null;
      costTracking: RunCostTracking;
      notes: string[];
    }
  | {
      ok: false;
      tool: "run_status";
      instanceId: string;
      message: string;
      httpStatus: number;
      notes: string[];
    };

export async function loadRunObservation(instanceId: string): Promise<RunObservation> {
  const instancesResult = await fetchInstances(undefined);
  if (!instancesResult.ok) {
    return {
      ok: false,
      tool: "run_status",
      instanceId,
      message: instancesResult.message,
      httpStatus: instancesResult.status,
      notes: ["The Lambda instances list could not be loaded."],
    };
  }

  const instance = instancesResult.instances.find((item) => item.id === instanceId);
  if (!instance) {
    return {
      ok: false,
      tool: "run_status",
      instanceId,
      message: "Instance " + instanceId + " was not found.",
      httpStatus: 404,
      notes: ["The instance id did not match any current Lambda instance."],
    };
  }

  const rawInstance = findRawInstanceRecord(instancesResult.raw, instanceId);
  const instanceMeta = extractInstanceMeta(rawInstance, instance);
  const runState = instanceMeta.status;
  const statusCommand = readCommandEnv("MCP_TRAINING_STATUS_COMMAND");
  const logPath = readCommandEnv("MCP_TRAINING_LOG_PATH");
  const notes: string[] = [];

  let remoteStatus: RemoteRunStatus | null = null;
  if (statusCommand) {
    try {
      const result = await runCommandOnInstance({
        instanceId,
        command: statusCommand,
      });
      const parsedJson = parseMaybeJson(result.stdout ?? "");
      remoteStatus = {
        ...result,
        parsedJson,
        parsedJsonType:
          parsedJson === null ? null : Array.isArray(parsedJson) ? "array" : typeof parsedJson,
      };
    } catch (error) {
      notes.push(
        error instanceof Error ? error.message : "The configured status command could not be executed."
      );
    }
  } else {
    notes.push(
      "MCP_TRAINING_STATUS_COMMAND is not configured, so no remote status command was run."
    );
  }

  const parsedRemote = remoteStatus?.parsedJson && isRecord(remoteStatus.parsedJson)
    ? remoteStatus.parsedJson
    : null;
  const elapsedInfo = extractElapsedSeconds(parsedRemote ?? null, rawInstance);
  const hourlyRateUsd = instanceMeta.hourlyRateUsd;
  const estimatedCostUsd = estimateCostUsd(hourlyRateUsd, elapsedInfo.elapsedSeconds);

  if (hourlyRateUsd === null) {
    notes.push("The Lambda API did not expose an hourly price for this instance.");
  }
  if (elapsedInfo.elapsedSeconds === null) {
    notes.push("No elapsed time could be derived from the status output or instance metadata.");
  }

  return {
    ok: true,
    tool: "run_status",
    instanceId,
    instance,
    instanceMeta,
    runState,
    statusCommand,
    remoteStatus,
    logPath,
    costTracking: {
      hourlyRateUsd,
      hourlyRateSource: instanceMeta.hourlyRateSource,
      elapsedSeconds: elapsedInfo.elapsedSeconds,
      elapsedSource: elapsedInfo.elapsedSource,
      estimatedCostUsd,
      ratePerSecondUsd: hourlyRateUsd === null ? null : hourlyRateUsd / 3600,
    },
    notes,
  };
}

const DEFAULT_BATCH_TAIL_MAX_INSTANCES = 5;
const MAX_BATCH_TAIL_INSTANCES = 10;
const MAX_LOG_TAIL_LINES = 5000;

/** Safe single-quoted fragment for remote bash -lc (same rules as tail_logs). */
export function shellSingleQuoteRemote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function buildRemoteTailCommand(logPath: string, lineCount: number): string {
  const n = Math.min(Math.max(1, Math.floor(lineCount)), MAX_LOG_TAIL_LINES);
  return "tail -n " + n + " " + shellSingleQuoteRemote(logPath);
}

export type LoadStatusPayloadOptions = {
  instanceId?: string;
  includeLogTails?: boolean;
  logPath?: string;
  logLines?: number;
  /** When set, only these instance ids receive tails (max length capped). */
  instanceIdsForTails?: string[];
};

export async function loadStatusPayload(options?: LoadStatusPayloadOptions) {
  const instanceId = options?.instanceId?.trim() || undefined;
  const includeLogTails = options?.includeLogTails === true;
  const logPathOverride = options?.logPath?.trim() || "";
  const logLines = options?.logLines ?? 200;
  const setup = getSetupSnapshot();
  const instancesResult = await fetchInstances(undefined);
  const payload: Record<string, unknown> = {
    ok: true,
    tool: "get_status",
    setup,
    note:
      "Watch/snipe UI config is returned only by the get_ui_settings tool (not duplicated here).",
  };

  if (!instancesResult.ok) {
    payload.ok = false;
    payload.instancesError = {
      httpStatus: instancesResult.status,
      message: instancesResult.message,
    };
  } else {
    payload.instances = instancesResult.instances;
  }

  if (instanceId) {
    const run = await loadRunObservation(instanceId);
    payload.run = run;
    payload.instanceStatus = run;
    payload.costTracking = run.ok ? run.costTracking : null;
  }

  if (includeLogTails && instancesResult.ok) {
    const configuredPath =
      logPathOverride.length > 0 ? logPathOverride : readCommandEnv("MCP_TRAINING_LOG_PATH");
    if (!configuredPath) {
      payload.logTailsError =
        "include_log_tails was true but no log_path was provided and MCP_TRAINING_LOG_PATH is not set.";
    } else {
      const requested = options?.instanceIdsForTails?.length
        ? options.instanceIdsForTails.map((id) => id.trim()).filter(Boolean)
        : instancesResult.instances.map((i) => i.id);
      const cap = options?.instanceIdsForTails?.length
        ? MAX_BATCH_TAIL_INSTANCES
        : DEFAULT_BATCH_TAIL_MAX_INSTANCES;
      const limited = requested.slice(0, cap);
      const command = buildRemoteTailCommand(configuredPath, logLines);
      const logTails: Array<{
        instanceId: string;
        ok: boolean;
        result?: Awaited<ReturnType<typeof runCommandOnInstance>>;
        message?: string;
      }> = [];
      for (const id of limited) {
        const exists = instancesResult.instances.some((i) => i.id === id);
        if (!exists) {
          logTails.push({
            instanceId: id,
            ok: false,
            message: "Instance id is not in the current Lambda instances list.",
          });
          continue;
        }
        try {
          const result = await runCommandOnInstance({ instanceId: id, command });
          logTails.push({ instanceId: id, ok: result.ok !== false, result });
        } catch (e) {
          logTails.push({
            instanceId: id,
            ok: false,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      payload.logTails = logTails;
      payload.logTailsMeta = {
        path: configuredPath,
        lines: Math.min(Math.max(1, Math.floor(logLines)), MAX_LOG_TAIL_LINES),
        instanceCount: logTails.length,
        cappedTo: cap,
      };
    }
  }

  return payload;
}
