import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { readCommandEnv, runCommandOnInstance } from "../runtime";

function shellSingleQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function interpretLogText(stdout: string, stderr: string) {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const patterns = [
    {
      key: "out_of_memory",
      severity: "error" as const,
      regex: /out of memory|cuda error: out of memory|oom killed/i,
      summary: "The logs suggest the run is running out of memory.",
      recommendation: "Reduce batch size, lower model size, or move to a larger GPU.",
    },
    {
      key: "cuda_error",
      severity: "error" as const,
      regex: /cuda error|cudnn|cuda runtime error/i,
      summary: "The logs show a CUDA runtime or driver issue.",
      recommendation: "Check CUDA, driver, and package compatibility on the instance.",
    },
    {
      key: "nccl_error",
      severity: "error" as const,
      regex: /nccl/i,
      summary: "The logs mention NCCL or distributed training communication issues.",
      recommendation: "Check multi-GPU connectivity, ranks, and network settings.",
    },
    {
      key: "permission_or_path",
      severity: "warning" as const,
      regex: /permission denied|no such file or directory/i,
      summary: "The log tail hit a file access or missing-path problem.",
      recommendation: "Verify the log path and file permissions on the instance.",
    },
    {
      key: "process_crash",
      severity: "error" as const,
      regex: /segmentation fault|core dumped|killed/i,
      summary: "The run appears to have crashed or been terminated.",
      recommendation: "Inspect the last successful step and the surrounding logs.",
    },
    {
      key: "network_issue",
      severity: "warning" as const,
      regex: /connection refused|timed out|network is unreachable/i,
      summary: "The logs suggest a connectivity problem.",
      recommendation: "Confirm the instance is reachable and the service is still running.",
    },
  ];

  const signals = patterns
    .filter((pattern) => pattern.regex.test(combined))
    .map((pattern) => ({
      key: pattern.key,
      severity: pattern.severity,
      summary: pattern.summary,
      recommendation: pattern.recommendation,
    }));

  if (signals.length === 0) {
    return {
      severity: "info" as const,
      summary: combined.trim().length > 0 ? "No known failure signatures were detected in the tailed logs." : "The log tail was empty.",
      signals,
      recommendation: "Continue tailing the logs or increase the line count if you need more context.",
    };
  }

  return {
    severity: signals.some((signal) => signal.severity === "error") ? "error" as const : "warning" as const,
    summary: signals.map((signal) => signal.summary).join(" "),
    signals,
    recommendation: signals[0].recommendation,
  };
}

export function registerTailLogsTool(server: FastMCP): void {
  server.addTool({
    name: "tail_logs",
    description:
      "Tail the configured log file on a target instance and return structured error interpretation.",
    parameters: z.object({
      instance_id: z.string().min(1),
      path: z.string().optional(),
      lines: z.number().int().min(1).max(2000).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      title: "tail_logs",
    },
    execute: async ({ instance_id, path, lines }) => {
      const configuredPath = (path?.trim() || "") || readCommandEnv("MCP_TRAINING_LOG_PATH");
      if (!configuredPath) {
        return {
          ok: false,
          tool: "tail_logs",
          instanceId: instance_id,
          message:
            "No log path was provided and MCP_TRAINING_LOG_PATH is not configured.",
        };
      }

      const lineCount = lines ?? 200;
      const command = "tail -n " + lineCount + " " + shellSingleQuote(configuredPath);
      const result = await runCommandOnInstance({
        instanceId: instance_id,
        command,
      });

      const interpretation = interpretLogText(result.stdout ?? "", result.stderr ?? "");

      return {
        ok: result.ok,
        tool: "tail_logs",
        instanceId: instance_id,
        logPath: configuredPath,
        lines: lineCount,
        command,
        result,
        interpretation,
      };
    },
  });
}
