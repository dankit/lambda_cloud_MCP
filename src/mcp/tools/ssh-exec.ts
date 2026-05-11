import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { runCommandOnInstance } from "../runtime";

export function registerSshExecTool(server: FastMCP): void {
  server.addTool({
    name: "ssh_exec",
    description:
      "Run an arbitrary shell script on the instance over SSH (bash -lc). Same power as other destructive tools; use specialized tools when they fit.",
    parameters: z.object({
      instance_id: z.string().min(1),
      command: z.string().min(1),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "ssh_exec",
    },
    execute: async ({ instance_id, command }) => {
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command,
      });
      return jsonToolResult({
        ok: result.ok,
        tool: "ssh_exec",
        instanceId: instance_id,
        result,
      });
    },
  });
}
