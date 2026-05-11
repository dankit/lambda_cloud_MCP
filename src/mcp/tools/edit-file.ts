import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { runCommandOnInstance } from "../runtime";

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function registerEditFileTool(server: FastMCP): void {
  server.addTool({
    name: "edit_file",
    description:
      "Write file contents on a target instance using a base64-safe transfer so the result is structured and repeatable.",
    parameters: z.object({
      instance_id: z.string().min(1),
      path: z.string().min(1),
      content: z.string(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "edit_file",
    },
    execute: async ({ instance_id, path, content }) => {
      const encoded = Buffer.from(content, "utf8").toString("base64");
      const command = [
        `mkdir -p "$(dirname ${shellSingleQuote(path)})"`,
        `cat <<'EOF_BASE64' | base64 -d > ${shellSingleQuote(path)}`,
        encoded,
        "EOF_BASE64",
      ].join("\n");
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command,
      });
      return jsonToolResult({
        ok: result.ok,
        tool: "edit_file",
        instanceId: instance_id,
        path,
        byteLength: Buffer.byteLength(content, "utf8"),
        result,
      });
    },
  });
}
