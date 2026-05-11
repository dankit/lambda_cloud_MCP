import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { readCommandEnv, runCommandOnInstance } from "../runtime";

function normalizeCommand(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function registerStartRunTool(server: FastMCP): void {
  server.addTool({
    name: "start_run",
    description:
      "Start the configured run command on a target instance and return structured execution results.",
    parameters: z.object({
      instance_id: z.string().min(1),
      command: z.string().optional(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "start_run",
    },
    execute: async ({ instance_id, command }) => {
      const configured = normalizeCommand(command) ?? readCommandEnv("MCP_TRAINING_START_COMMAND");
      if (!configured) {
        return {
          ok: false,
          tool: "start_run",
          instanceId: instance_id,
          message:
            "No start command was provided and MCP_TRAINING_START_COMMAND is not configured.",
        };
      }
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: configured,
      });
      return {
        ok: result.ok,
        tool: "start_run",
        instanceId: instance_id,
        command: configured,
        result,
      };
    },
  });
}
