import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { buildTemplatedCommand } from "../command-template";
import { jsonToolResult } from "../json-tool-result";
import { readCommandEnv, runCommandOnInstance } from "../runtime";

function normalizeCommand(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function registerStartRunTool(server: FastMCP): void {
  server.addTool({
    name: "start_run",
    description:
      "Start training on the instance. Uses MCP_TRAINING_START_COMMAND when no command override is passed. Optional parameters replace {{name}} placeholders in the command; optional env exports safe shell names before the command runs.",
    parameters: z.object({
      instance_id: z.string().min(1),
      command: z.string().optional(),
      parameters: z.record(z.string(), z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      strict_placeholders: z.boolean().optional(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "start_run",
    },
    execute: async ({
      instance_id,
      command,
      parameters,
      env,
      strict_placeholders,
    }) => {
      const base = normalizeCommand(command) ?? readCommandEnv("MCP_TRAINING_START_COMMAND");
      if (!base) {
        return jsonToolResult({
          ok: false,
          tool: "start_run",
          instanceId: instance_id,
          message:
            "No start command was provided and MCP_TRAINING_START_COMMAND is not configured.",
        });
      }
      let resolved: string;
      try {
        resolved = buildTemplatedCommand(base, {
          parameters: parameters ?? {},
          env: env ?? {},
          strictPlaceholders: strict_placeholders === true,
        });
      } catch (e) {
        return jsonToolResult({
          ok: false,
          tool: "start_run",
          instanceId: instance_id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: resolved,
      });
      return jsonToolResult({
        ok: result.ok,
        tool: "start_run",
        instanceId: instance_id,
        command: resolved,
        result,
      });
    },
  });
}
