import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { readCommandEnv, runCommandOnInstance } from "../runtime";

function normalizeCommand(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function registerSyncRepoTool(server: FastMCP): void {
  server.addTool({
    name: "sync_repo",
    description:
      "Run the configured repository/environment sync command on a target instance, or return the command that would run if no command is configured.",
    parameters: z.object({
      instance_id: z.string().min(1),
      command: z.string().optional(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "sync_repo",
    },
    execute: async ({ instance_id, command }) => {
      const configured = normalizeCommand(command) ?? readCommandEnv("MCP_ENV_SETUP_COMMAND");
      if (!configured) {
        return {
          ok: false,
          tool: "sync_repo",
          instanceId: instance_id,
          message:
            "No sync command was provided and MCP_ENV_SETUP_COMMAND is not configured.",
        };
      }
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: configured,
      });
      return {
        ok: result.ok,
        tool: "sync_repo",
        instanceId: instance_id,
        command: configured,
        result,
      };
    },
  });
}
