import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { readCommandEnv, runCommandOnInstance } from "../runtime";

function normalizeCommand(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function registerSetupTrainingEnvironmentTool(server: FastMCP): void {
  server.addTool({
    name: "setup_training_environment",
    description:
      "Run a user-defined shell script on the instance to prepare the training environment (install deps, clone/sync, etc.). Uses MCP_ENV_SETUP_COMMAND when no command override is passed.",
    parameters: z.object({
      instance_id: z.string().min(1),
      command: z.string().optional(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "setup_training_environment",
    },
    execute: async ({ instance_id, command }) => {
      const configured =
        normalizeCommand(command) ?? readCommandEnv("MCP_ENV_SETUP_COMMAND");
      if (!configured) {
        return jsonToolResult({
          ok: false,
          tool: "setup_training_environment",
          instanceId: instance_id,
          message:
            "No command was provided and MCP_ENV_SETUP_COMMAND is not configured.",
        });
      }
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: configured,
      });
      return jsonToolResult({
        ok: result.ok,
        tool: "setup_training_environment",
        instanceId: instance_id,
        command: configured,
        result,
      });
    },
  });
}
