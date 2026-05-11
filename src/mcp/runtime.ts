import path from "node:path";
import { config as loadDotenvFromFile } from "dotenv";
import { envConfigSnapshot, resolveApiKey } from "../lib/credentials";
import { lambdaFetch } from "../lib/lambda";
import { loadWatchConfigForMcp } from "../lib/watch-config-file";
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
  const relativeFile = raw && raw.length > 0 ? raw : ".env.local";
  const resolved = path.resolve(process.cwd(), relativeFile);
  loadDotenvFromFile({ path: resolved, override: false });
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

export function getSetupSnapshot() {
  return {
    environment: envConfigSnapshot(),
    commandHints: listTrainingEnvironmentHints(),
    configuredCommands: {
      syncRepo: readCommandEnv("MCP_ENV_SETUP_COMMAND"),
      startRun: readCommandEnv("MCP_TRAINING_START_COMMAND"),
      stopRun: readCommandEnv("MCP_TRAINING_STOP_COMMAND"),
      getStatus: readCommandEnv("MCP_TRAINING_STATUS_COMMAND"),
    },
  };
}

export async function fetchInstances(clusterId?: string) {
  const apiKey = requireApiKey();
  const apiPath =
    clusterId === undefined || clusterId === ""
      ? "/instances"
      : `/instances?cluster_id=${encodeURIComponent(clusterId)}`;
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
      message: `Instance ${instanceId} was not found.`,
      httpStatus: 404,
    };
  }
  const host = match.ip?.trim() || match.hostname?.trim() || "";
  if (!host) {
    return {
      ok: false as const,
      message:
        `Instance ${instanceId} has no public host to SSH into.` +
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

export async function loadStatusPayload(instanceId?: string) {
  const setup = getSetupSnapshot();
  const watchConfig = await loadWatchConfigForMcp();
  const instancesResult = await fetchInstances(undefined);
  const payload: Record<string, unknown> = {
    ok: true,
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
    const statusCommand = readCommandEnv("MCP_TRAINING_STATUS_COMMAND");
    if (statusCommand) {
      payload.instanceStatus = await runCommandOnInstance({
        instanceId,
        command: statusCommand,
      });
    } else {
      payload.instanceStatus = {
        ok: false,
        instanceId,
        message:
          "MCP_TRAINING_STATUS_COMMAND is not configured, so no remote status command was run.",
      };
    }
  }

  return payload;
}
