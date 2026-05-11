import path from "node:path";
import { config as loadDotenvFromFile } from "dotenv";
import { envConfigSnapshot, resolveApiKey } from "../lib/credentials";
import { lambdaFetch } from "../lib/lambda";
import { loadWatchConfigForMcp } from "../lib/watch-config-file";
import {
  listTrainingEnvironmentHints,
  readTrainingCommand,
  readTrainingCommandsConfig,
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
  const files = raw && raw.length > 0 ? [raw] : [".env.local", ".env"];
  const seen = new Set<string>();
  for (const relativeFile of files) {
    const resolved = path.resolve(process.cwd(), relativeFile);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    loadDotenvFromFile({ path: resolved, override: false });
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
  const trainingCommandMap: Record<string, keyof Omit<
    ReturnType<typeof readTrainingCommandsConfig>,
    "source" | "rawJson"
  >> = {
    MCP_ENV_SETUP_COMMAND: "setup",
    MCP_TRAINING_START_COMMAND: "start",
    MCP_TRAINING_STOP_COMMAND: "stop",
    MCP_TRAINING_STATUS_COMMAND: "status",
    MCP_TRAINING_LOG_PATH: "logPath",
  };
  const mapped = trainingCommandMap[name];
  if (mapped) {
    return readTrainingCommand(mapped);
  }
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
    trainingCommands: readTrainingCommandsConfig(),
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
      const parsedJson = parseMaybeJson(result.stdout);
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

export async function loadStatusPayload(instanceId?: string) {
  const setup = getSetupSnapshot();
  const watchConfig = await loadWatchConfigForMcp();
  const instancesResult = await fetchInstances(undefined);
  const payload: Record<string, unknown> = {
    ok: true,
    tool: "get_status",
    setup,
    watchConfig,
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

  return payload;
}
