import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { getSetupSnapshot } from "../runtime";

export function registerSetupEnvTool(server: FastMCP): void {
  server.addTool({
    name: "setup_env",
    description:
      "Return the current MCP environment snapshot, configured command hints, and setup defaults as structured JSON.",
    parameters: z.object({}),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      title: "setup_env",
    },
    execute: async () => ({
      ok: true,
      tool: "setup_env",
      ...getSetupSnapshot(),
    }),
  });
}
