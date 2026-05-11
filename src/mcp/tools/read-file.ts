import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { runCommandOnInstance, shellSingleQuoteRemote } from "../runtime";

const DEFAULT_MAX_BYTES = 262_144;
const MAX_READ_BYTES = 4 * 1024 * 1024;

export function registerReadFileTool(server: FastMCP): void {
  server.addTool({
    name: "read_file",
    description:
      "Read a file on the instance via SSH. Returns UTF-8 text when possible, or base64 when encoding is base64. Enforces max_bytes on the remote side.",
    parameters: z.object({
      instance_id: z.string().min(1),
      path: z.string().min(1),
      max_bytes: z.number().int().min(1).max(MAX_READ_BYTES).optional(),
      encoding: z.enum(["utf8", "base64"]).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      title: "read_file",
    },
    execute: async ({ instance_id, path, max_bytes, encoding }) => {
      const cap = Math.min(max_bytes ?? DEFAULT_MAX_BYTES, MAX_READ_BYTES);
      const qp = shellSingleQuoteRemote(path);
      const remoteScript = [
        `f=${qp}`,
        "if [ ! -r \"$f\" ]; then echo 'not readable or missing' >&2; exit 1; fi",
        `max=${cap}`,
        "sz=$(stat -c%s \"$f\" 2>/dev/null || echo 0)",
        "if [ \"$sz\" -gt \"$max\" ]; then echo \"file larger than max_bytes ($max)\" >&2; exit 1; fi",
        "base64 -w0 \"$f\"",
      ].join("\n");

      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: remoteScript,
      });

      if (!result.ok) {
        return jsonToolResult({
          ok: false,
          tool: "read_file",
          instanceId: instance_id,
          path,
          maxBytes: cap,
          result,
        });
      }

      const enc = encoding ?? "utf8";
      const b64 = (result.stdout ?? "").replace(/\s+/g, "");
      if (enc === "base64") {
        return jsonToolResult({
          ok: true,
          tool: "read_file",
          instanceId: instance_id,
          path,
          maxBytes: cap,
          encoding: "base64" as const,
          contentBase64: b64,
          result,
        });
      }

      let text: string;
      try {
        text = Buffer.from(b64, "base64").toString("utf8");
      } catch {
        return jsonToolResult({
          ok: false,
          tool: "read_file",
          instanceId: instance_id,
          path,
          message: "Could not decode file as base64 from remote.",
          result,
        });
      }

      return jsonToolResult({
        ok: true,
        tool: "read_file",
        instanceId: instance_id,
        path,
        maxBytes: cap,
        encoding: "utf8" as const,
        content: text,
        result,
      });
    },
  });
}
