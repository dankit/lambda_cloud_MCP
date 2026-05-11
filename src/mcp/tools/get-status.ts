import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { loadStatusPayload } from "../runtime";

export function registerGetStatusTool(server: FastMCP): void {
  server.addTool({
    name: "get_status",
    description:
      "Return a structured snapshot of the MCP environment, Lambda instances, watch config, and optional remote status output.",
    parameters: z.object({
      instance_id: z.string().optional(),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      title: "get_status",
    },
    execute: async ({ instance_id }) => loadStatusPayload(instance_id),
  });
}
