import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { buildTemplatedCommand } from "../command-template";
import {
  buildBackgroundJobScript,
  newJobId,
  parseBackgroundStartOutput,
} from "../jobs";
import { jsonToolResult } from "../json-tool-result";
import { runCommandOnInstance } from "../runtime";
import { mergeSession } from "../session-state";

export function registerSshExecTool(server: FastMCP): void {
  server.addTool({
    name: "ssh_exec",
    description:
      "Run a shell command on the instance over SSH (bash -lc) and return structured output (exitCode, stdout, stderr, timing). Optional workdir/env persist for later calls on the same instance; parameters fill {{name}} placeholders. Set background:true for long jobs (training) that must outlive the SSH timeout, then poll with job_status.",
    parameters: z.object({
      instance_id: z.string().min(1),
      command: z.string().min(1),
      workdir: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      parameters: z.record(z.string(), z.string()).optional(),
      background: z.boolean().optional(),
      timeout_ms: z.number().int().min(1000).max(900_000).optional(),
      reset_session: z.boolean().optional(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "ssh_exec",
    },
    execute: async ({
      instance_id,
      command,
      workdir,
      env,
      parameters,
      background,
      timeout_ms,
      reset_session,
    }) => {
      let resolved: string;
      try {
        resolved = buildTemplatedCommand(command, {
          parameters: parameters ?? {},
          strictPlaceholders: false,
        });
      } catch (e) {
        return jsonToolResult({
          ok: false,
          tool: "ssh_exec",
          instanceId: instance_id,
          message: e instanceof Error ? e.message : String(e),
        });
      }

      const session = mergeSession(instance_id, {
        workdir,
        env,
        reset: reset_session === true,
      });

      if (background === true) {
        const jobId = newJobId();
        const script = buildBackgroundJobScript({ jobId, command: resolved });
        const result = await runCommandOnInstance({
          instanceId: instance_id,
          command: script,
          workdir: session.workdir,
          env: session.env,
          timeoutMs: timeout_ms,
        });
        const { pid } = parseBackgroundStartOutput(result.stdout ?? "");
        return jsonToolResult({
          ok: result.ok,
          tool: "ssh_exec",
          mode: "background",
          instanceId: instance_id,
          jobId,
          pid,
          logPath: `~/.lambda-mcp/jobs/${jobId}.log`,
          session,
          result,
        });
      }

      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: resolved,
        workdir: session.workdir,
        env: session.env,
        timeoutMs: timeout_ms,
      });
      return jsonToolResult({
        ok: result.ok,
        tool: "ssh_exec",
        mode: "sync",
        instanceId: instance_id,
        session,
        result,
      });
    },
  });
}
