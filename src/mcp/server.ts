/**
 * MCP stdio server for Lambda GPU availability: instances, watch/snipe config, summaries.
 * Run: `npm run mcp` with LAMBDA_API_KEY and watch/snipe config via optional
 * `LAMBDA_WATCH_HTTP_URL` (GET) or `LAMBDA_WATCH_CONFIG_PATH` (disk).
 */

import { resolveApiKey } from "../lib/credentials";
import { lambdaFetch } from "../lib/lambda";
import { loadWatchConfigForMcp } from "../lib/watch-config-file";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  formatError,
  parseInstancesListPayload,
} from "../app/home/parsers";
import type { InstanceDetail } from "../app/home/types";
import * as z from "zod";

function requireApiKey(): string {
  const { key } = resolveApiKey(null);
  if (!key) {
    throw new Error(
      "LAMBDA_API_KEY is not set. Add it to .env or your MCP server env block."
    );
  }
  return key;
}

async function fetchInstances(clusterId: string | undefined) {
  const apiKey = requireApiKey();
  const path =
    clusterId === undefined || clusterId === ""
      ? "/instances"
      : `/instances?cluster_id=${encodeURIComponent(clusterId)}`;
  const { ok, status, body } = await lambdaFetch(path, { apiKey });
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
    instances: parseInstancesListPayload(body ?? {}),
    raw: body,
  };
}

function summarizeGpuTypes(params: {
  filterType: string | undefined;
  capacityAlerts: Array<{ instance_type_name: string; region_name: string }>;
  snipePrefs: Record<string, { enabled: boolean; ssh_key_name: string }>;
  instances: InstanceDetail[];
}) {
  const typeNames = new Set<string>();
  const { filterType, capacityAlerts, snipePrefs, instances } = params;
  if (filterType?.trim()) {
    typeNames.add(filterType.trim());
  }
  for (const a of capacityAlerts) typeNames.add(a.instance_type_name);
  for (const k of Object.keys(snipePrefs)) typeNames.add(k);
  for (const i of instances) {
    const t = i.instance_type_name?.trim();
    if (t) typeNames.add(t);
  }
  const gpuTypes: Record<
    string,
    {
      watched: boolean;
      watch_region: string;
      snipe: {
        enabled: boolean;
        ssh_key_name: string;
      };
      scheduled_instances: Array<{
        id: string;
        status?: string;
        instance_type_name?: string;
        region?: InstanceDetail["region"];
        ip?: string;
        name?: string;
      }>;
    }
  > = {};

  for (const name of [...typeNames].sort()) {
    const alert = capacityAlerts.find((a) => a.instance_type_name === name);
    const pref = snipePrefs[name] ?? {
      enabled: false,
      ssh_key_name: "",
    };
    const scheduled_instances = instances
      .filter((i) => i.instance_type_name === name)
      .map((i) => ({
        id: i.id,
        status: i.status,
        instance_type_name: i.instance_type_name,
        region: i.region,
        ip: i.ip,
        name: i.name,
      }));
    gpuTypes[name] = {
      watched: Boolean(alert),
      watch_region:
        alert !== undefined ? (alert.region_name?.trim() ?? "") : "",
      snipe: {
        enabled: pref.enabled,
        ssh_key_name: pref.ssh_key_name ?? "",
      },
      scheduled_instances,
    };
  }

  return gpuTypes;
}

function jsonToolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

const mcpServer = new McpServer({
  name: "lambda-gpu-availability",
  version: "0.1.0",
});

mcpServer.registerTool(
  "lambda_list_instances",
  {
    description:
      "List Lambda Cloud instances (scheduled machines) with id, status, IPs, region, instance_type_name when returned by the API.",
    inputSchema: {
      cluster_id: z
        .string()
        .optional()
        .describe("Optional Lambda cluster_id query parameter."),
    },
  },
  async ({ cluster_id }) => {
    try {
      const result = await fetchInstances(cluster_id);
      if (!result.ok) {
        return jsonToolResult({
          ok: false,
          httpStatus: result.status,
          message: result.message,
        });
      }
      return jsonToolResult({
        ok: true,
        instances: result.instances,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return jsonToolResult({ ok: false, message });
    }
  }
);

mcpServer.registerTool(
  "lambda_get_watch_snipe_config",
  {
    description:
      "Read capacity alert + snipe preferences from Next GET /api/watch-config (when LAMBDA_WATCH_HTTP_URL is set) or from LAMBDA_WATCH_CONFIG_PATH (JSON file synced by the Next UI POST). Prefer HTTP URL when MCP cannot read the shared file.",
    inputSchema: z.object({}),
  },
  async () => {
    const loaded = await loadWatchConfigForMcp();
    if (!loaded.ok) {
      if (loaded.source === "unset") {
        return jsonToolResult({
          ok: false,
          watchConfigSource: "unset",
          message: loaded.message,
        });
      }
      if (loaded.source === "file") {
        return jsonToolResult({
          ok: false,
          watchConfigSource: "invalid_file",
          path: loaded.path,
          error: loaded.error,
        });
      }
      return jsonToolResult({
        ok: false,
        watchConfigSource: "invalid_http",
        url: loaded.url,
        error: loaded.error,
        ...(loaded.httpStatus !== undefined
          ? { httpStatus: loaded.httpStatus }
          : {}),
      });
    }
    if (loaded.source === "http") {
      return jsonToolResult({
        ok: true,
        watchConfigSource: "http",
        url: loaded.url,
        capacityAlerts: loaded.value.capacityAlerts,
        snipePrefs: loaded.value.snipePrefs,
      });
    }
    return jsonToolResult({
      ok: true,
      watchConfigSource: "file",
      path: loaded.path,
      capacityAlerts: loaded.value.capacityAlerts,
      snipePrefs: loaded.value.snipePrefs,
    });
  }
);

mcpServer.registerTool(
  "lambda_summarize_gpu_types",
  {
    description:
      "Combine live instances with watch/snipe config: per GPU type, whether it is watched, snipe (autoprovision) settings, and any matching instances with status.",
    inputSchema: {
      instance_type_name: z
        .string()
        .optional()
        .describe(
          "If set, include this type in the summary even if not watched and no matching instances."
        ),
    },
  },
  async ({ instance_type_name }) => {
    try {
      let capacityAlerts: Array<{
        instance_type_name: string;
        region_name: string;
      }> = [];
      let snipePrefs: Record<string, { enabled: boolean; ssh_key_name: string }> =
        {};
      let watchMeta:
        | { watchConfigSource: "unset" }
        | {
            watchConfigSource: "invalid_file";
            path: string;
            error: string;
          }
        | {
            watchConfigSource: "invalid_http";
            url: string;
            error: string;
            httpStatus?: number;
          }
        | { watchConfigSource: "file"; path: string }
        | { watchConfigSource: "http"; url: string } = {
        watchConfigSource: "unset",
      };

      const loaded = await loadWatchConfigForMcp();
      if (!loaded.ok) {
        if (loaded.source === "unset") {
          watchMeta = { watchConfigSource: "unset" };
        } else if (loaded.source === "file") {
          watchMeta = {
            watchConfigSource: "invalid_file",
            path: loaded.path,
            error: loaded.error,
          };
        } else {
          watchMeta = {
            watchConfigSource: "invalid_http",
            url: loaded.url,
            error: loaded.error,
            ...(loaded.httpStatus !== undefined
              ? { httpStatus: loaded.httpStatus }
              : {}),
          };
        }
      } else {
        capacityAlerts = loaded.value.capacityAlerts;
        snipePrefs = loaded.value.snipePrefs;
        watchMeta =
          loaded.source === "http"
            ? { watchConfigSource: "http", url: loaded.url }
            : { watchConfigSource: "file", path: loaded.path };
      }

      const instResult = await fetchInstances(undefined);
      if (!instResult.ok) {
        return jsonToolResult({
          ok: false,
          httpStatus: instResult.status,
          message: instResult.message,
          watch: watchMeta,
        });
      }

      const gpu_types = summarizeGpuTypes({
        filterType: instance_type_name,
        capacityAlerts,
        snipePrefs,
        instances: instResult.instances,
      });

      return jsonToolResult({
        ok: true,
        watch: watchMeta,
        gpu_types,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return jsonToolResult({ ok: false, message });
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
