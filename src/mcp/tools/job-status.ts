import type { FastMCP } from "fastmcp";
import * as z from "zod";
import {
  buildJobSignalScript,
  buildJobStatusScript,
  MAX_JOB_LOG_LINES,
  parseJobStatusOutput,
} from "../jobs";
import { jsonToolResult } from "../json-tool-result";
import { interpretLogText } from "../log-interpret";
import { runCommandOnInstance } from "../runtime";

export function registerJobStatusTool(server: FastMCP): void {
  server.addTool({
    name: "job_status",
    description:
      "Inspect or stop a background job started by ssh_exec (background:true). action 'status' reports running/exitCode + a log tail, 'logs' returns more log lines (optional OOM/CUDA failure interpretation), 'stop' signals the job's process group (INT/TERM/KILL).",
    parameters: z.object({
      instance_id: z.string().min(1),
      job_id: z.string().min(1),
      action: z.enum(["status", "logs", "stop"]).optional(),
      lines: z.number().int().min(1).max(MAX_JOB_LOG_LINES).optional(),
      signal: z.enum(["INT", "TERM", "KILL"]).optional(),
      interpret: z.boolean().optional(),
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      title: "job_status",
    },
    execute: async ({ instance_id, job_id, action, lines, signal, interpret }) => {
      const op = action ?? "status";

      if (op === "stop") {
        const script = buildJobSignalScript(job_id, signal ?? "TERM");
        const result = await runCommandOnInstance({
          instanceId: instance_id,
          command: script,
        });
        return jsonToolResult({
          ok: result.ok,
          tool: "job_status",
          action: "stop",
          instanceId: instance_id,
          jobId: job_id,
          signal: signal ?? "TERM",
          result,
        });
      }

      const lineCount = lines ?? (op === "logs" ? 500 : 100);
      const script = buildJobStatusScript(job_id, lineCount);
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: script,
      });

      if (!result.ok) {
        return jsonToolResult({
          ok: false,
          tool: "job_status",
          action: op,
          instanceId: instance_id,
          jobId: job_id,
          result,
        });
      }

      const status = parseJobStatusOutput(result.stdout ?? "");
      const doInterpret = interpret !== false;
      const interpretation = doInterpret
        ? interpretLogText(status.logTail)
        : null;

      return jsonToolResult({
        ok: true,
        tool: "job_status",
        action: op,
        instanceId: instance_id,
        jobId: job_id,
        found: status.found,
        running: status.running,
        pid: status.pid,
        exitCode: status.exitCode,
        logPath: status.logPath,
        logTail: status.logTail,
        interpretation,
        result,
      });
    },
  });
}
