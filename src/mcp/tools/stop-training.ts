import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { readCommandEnv, runCommandOnInstance, shellSingleQuoteRemote } from "../runtime";

function normalizeCommand(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

const signalTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pid_file"),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal("pgrep_pattern"),
    pattern: z.string().min(1).max(512),
  }),
]);

export function registerStopTrainingTool(server: FastMCP): void {
  server.addTool({
    name: "stop_training",
    description:
      "Stop training on the instance: either run a shell stop script (MCP_TRAINING_STOP_COMMAND or override), or send SIGINT/SIGTERM to a process identified by a PID file or a pgrep-style pattern. Signal mode is not a real TTY Ctrl+C to another session; use run_command for tmux/docker-specific stops.",
    parameters: z.object({
      instance_id: z.string().min(1),
      strategy: z.enum(["run_command", "send_signal"]),
      command: z.string().optional(),
      signal: z.enum(["INT", "TERM"]).optional(),
      signal_target: signalTargetSchema.optional(),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: true,
      title: "stop_training",
    },
    execute: async ({
      instance_id,
      strategy,
      command,
      signal,
      signal_target,
    }) => {
      if (strategy === "run_command") {
        const configured =
          normalizeCommand(command) ?? readCommandEnv("MCP_TRAINING_STOP_COMMAND");
        if (!configured) {
          return jsonToolResult({
            ok: false,
            tool: "stop_training",
            instanceId: instance_id,
            message:
              "strategy run_command requires a command or MCP_TRAINING_STOP_COMMAND.",
          });
        }
        const result = await runCommandOnInstance({
          instanceId: instance_id,
          command: configured,
        });
        return jsonToolResult({
          ok: result.ok,
          tool: "stop_training",
          strategy,
          instanceId: instance_id,
          command: configured,
          result,
        });
      }

      const sig = signal ?? "INT";
      const flag = sig === "TERM" ? "-TERM" : "-INT";
      if (!signal_target) {
        return jsonToolResult({
          ok: false,
          tool: "stop_training",
          instanceId: instance_id,
          message: "strategy send_signal requires signal_target (pid_file or pgrep_pattern).",
        });
      }

      let remoteScript: string;
      if (signal_target.kind === "pid_file") {
        const q = shellSingleQuoteRemote(signal_target.path);
        remoteScript = [
          `f=${q}`,
          'if [ ! -r "$f" ]; then echo "pid file missing or not readable" >&2; exit 1; fi',
          'pid=$(tr -d "[:space:]" < "$f" | head -n1)',
          'if [ -z "$pid" ]; then echo "pid file empty" >&2; exit 1; fi',
          "kill " + flag + ' -- "$pid" 2>/dev/null || true',
        ].join("\n");
      } else {
        const qpat = shellSingleQuoteRemote(signal_target.pattern);
        remoteScript = `pkill ${flag} -f -- ${qpat} 2>/dev/null || true`;
      }

      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command: remoteScript,
      });
      return jsonToolResult({
        ok: result.ok,
        tool: "stop_training",
        strategy,
        signal: sig,
        signal_target,
        command: remoteScript,
        result,
      });
    },
  });
}
