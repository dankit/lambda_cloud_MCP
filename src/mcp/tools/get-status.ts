import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { loadStatusPayload } from "../runtime";

export function registerGetStatusTool(server: FastMCP): void {
  server.addTool({
    name: "get_status",
    description:
      "Lambda instances, MCP setup snapshot (env + command hints), and an optional deep-dive for one instance_id (status command + cost tracking). For watch/snipe UI config, use get_ui_settings. To tail logs or run anything else on the box, use ssh_exec.",
    parameters: z.object({
      instance_id: z.string().optional(),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      title: "get_status",
    },
    execute: async ({ instance_id }) =>
      jsonToolResult(
        await loadStatusPayload({
          instanceId: instance_id?.trim() || undefined,
        })
      ),
  });
}
