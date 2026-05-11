import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { loadStatusPayload } from "../runtime";

export function registerGetStatusTool(server: FastMCP): void {
  server.addTool({
    name: "get_status",
    description:
      "Lambda instances, MCP setup snapshot (env + command hints), optional deep-dive for one instance_id (status command + cost), and optional batch log tails. For watch/snipe UI (auto-provision GPUs), use get_ui_settings.",
    parameters: z.object({
      instance_id: z.string().optional(),
      include_log_tails: z.boolean().optional(),
      log_path: z.string().optional(),
      log_lines: z.number().int().min(1).max(5000).optional(),
      instance_ids_for_tails: z.array(z.string()).max(10).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      title: "get_status",
    },
    execute: async ({
      instance_id,
      include_log_tails,
      log_path,
      log_lines,
      instance_ids_for_tails,
    }) =>
      jsonToolResult(
        await loadStatusPayload({
          instanceId: instance_id?.trim() || undefined,
          includeLogTails: include_log_tails === true,
          logPath: log_path?.trim() || undefined,
          logLines: log_lines,
          instanceIdsForTails: instance_ids_for_tails,
        })
      ),
  });
}
