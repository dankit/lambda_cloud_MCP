import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { readCommandEnv, runCommandOnInstance } from "../runtime";

function normalizeCommand(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function registerStopRunTool(server: FastMCP): void {
  server.addTool({
    name: "stop_run",
    description:
      "Stop the configured run command on a target instance and return structured execution results.",
    parameters: z.object({
      instance_id: z.string().min(1),
      command: z.string().optional(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "stop_run",
    },
    execute: async ({ instance_id, command }) => {
      const configured = normalizeCommand(command) ?? readCommandEnv("MCP_TRAINING_STOP_COMMAND");
      if (!configured) {
        return {
          ok: false,
          tool: "stop_run",
          instanceId: instance_id,
          message:
            "No stop command was provided and MCP_TRAINING_STOP_COMMAND is not configured.",
        };
      }
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: configured,
      });
      return {
        ok: result.ok,
        tool: "stop_run",
        instanceId: instance_id,
        command: configured,
        result,
      };
    },
  });
}
