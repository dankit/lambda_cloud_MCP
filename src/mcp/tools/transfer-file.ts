import { existsSync } from "node:fs";
import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { runScp } from "../../lib/mcp-ssh";
import { jsonToolResult } from "../json-tool-result";
import {
  resolveInstanceHostById,
  runCommandOnInstance,
  shellSingleQuoteRemote,
} from "../runtime";

export function registerTransferFileTool(server: FastMCP): void {
  server.addTool({
    name: "transfer_file",
    description:
      "Move files to/from an instance. mode 'write' writes inline UTF-8 content to a remote path (base64-safe). mode 'upload' scp-copies a local file/dir to the instance; mode 'download' scp-copies a remote file/dir to the local machine. Use recursive for directories. For reading small remote text, ssh_exec 'cat ...' is simpler.",
    parameters: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("write"),
        instance_id: z.string().min(1),
        remote_path: z.string().min(1),
        content: z.string(),
      }),
      z.object({
        mode: z.literal("upload"),
        instance_id: z.string().min(1),
        local_path: z.string().min(1),
        remote_path: z.string().min(1),
        recursive: z.boolean().optional(),
      }),
      z.object({
        mode: z.literal("download"),
        instance_id: z.string().min(1),
        remote_path: z.string().min(1),
        local_path: z.string().min(1),
        recursive: z.boolean().optional(),
      }),
    ]),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "transfer_file",
    },
    execute: async (args) => {
      if (args.mode === "write") {
        const { instance_id, remote_path, content } = args;
        const encoded = Buffer.from(content, "utf8").toString("base64");
        const qp = shellSingleQuoteRemote(remote_path);
        const command = [
          `mkdir -p "$(dirname ${qp})"`,
          `cat <<'EOF_BASE64' | base64 -d > ${qp}`,
          encoded,
          "EOF_BASE64",
        ].join("\n");
        const result = await runCommandOnInstance({
          instanceId: instance_id,
          command,
        });
        return jsonToolResult({
          ok: result.ok,
          tool: "transfer_file",
          mode: "write",
          instanceId: instance_id,
          remotePath: remote_path,
          byteLength: Buffer.byteLength(content, "utf8"),
          result,
        });
      }

      const { instance_id } = args;

      if (args.mode === "upload" && !existsSync(args.local_path)) {
        return jsonToolResult({
          ok: false,
          tool: "transfer_file",
          mode: "upload",
          instanceId: instance_id,
          message: `Local path does not exist: ${args.local_path}`,
        });
      }

      const hostResult = await resolveInstanceHostById(instance_id);
      if (!hostResult.ok) {
        return jsonToolResult({
          ok: false,
          tool: "transfer_file",
          mode: args.mode,
          instanceId: instance_id,
          message: hostResult.message,
          httpStatus: hostResult.httpStatus,
        });
      }

      const result = await runScp({
        host: hostResult.host,
        direction: args.mode === "upload" ? "upload" : "download",
        localPath: args.local_path,
        remotePath: args.remote_path,
        recursive: args.recursive === true,
      });

      return jsonToolResult({
        ok: result.ok,
        tool: "transfer_file",
        mode: args.mode,
        instanceId: instance_id,
        result,
      });
    },
  });
}
