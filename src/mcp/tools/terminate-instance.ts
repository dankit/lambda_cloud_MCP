import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { terminateLambdaInstance } from "../runtime";

export function registerTerminateInstanceTool(server: FastMCP): void {
  server.addTool({
    name: "terminate_instance",
    description:
      "Terminate a Lambda Cloud GPU instance via the HTTP API (same as the UI terminate action). This stops billing for that instance.",
    parameters: z.object({
      instance_id: z.string().min(1),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "terminate_instance",
    },
    execute: async ({ instance_id }) => {
      const out = await terminateLambdaInstance(instance_id);
      return jsonToolResult({
        ok: out.ok,
        tool: "terminate_instance",
        instanceId: instance_id,
        httpStatus: out.httpStatus,
        body: out.body,
        message: out.message,
      });
    },
  });
}
