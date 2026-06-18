/**
 * Heuristic interpretation of training/log output: scan for common failure
 * signatures (OOM, CUDA, NCCL, crashes, connectivity) and return a structured
 * summary with severity and a recommendation. Opt-in; never blocks raw output.
 */

export type LogSignal = {
  key: string;
  severity: "error" | "warning";
  summary: string;
  recommendation: string;
};

export type LogInterpretation = {
  severity: "info" | "warning" | "error";
  summary: string;
  signals: LogSignal[];
  recommendation: string;
};

const PATTERNS: Array<LogSignal & { regex: RegExp }> = [
  {
    key: "out_of_memory",
    severity: "error",
    regex: /out of memory|cuda error: out of memory|oom killed/i,
    summary: "The logs suggest the run is running out of memory.",
    recommendation: "Reduce batch size, lower model size, or move to a larger GPU.",
  },
  {
    key: "cuda_error",
    severity: "error",
    regex: /cuda error|cudnn|cuda runtime error/i,
    summary: "The logs show a CUDA runtime or driver issue.",
    recommendation: "Check CUDA, driver, and package compatibility on the instance.",
  },
  {
    key: "nccl_error",
    severity: "error",
    regex: /nccl/i,
    summary: "The logs mention NCCL or distributed training communication issues.",
    recommendation: "Check multi-GPU connectivity, ranks, and network settings.",
  },
  {
    key: "permission_or_path",
    severity: "warning",
    regex: /permission denied|no such file or directory/i,
    summary: "The log tail hit a file access or missing-path problem.",
    recommendation: "Verify the log path and file permissions on the instance.",
  },
  {
    key: "process_crash",
    severity: "error",
    regex: /segmentation fault|core dumped|killed/i,
    summary: "The run appears to have crashed or been terminated.",
    recommendation: "Inspect the last successful step and the surrounding logs.",
  },
  {
    key: "network_issue",
    severity: "warning",
    regex: /connection refused|timed out|network is unreachable/i,
    summary: "The logs suggest a connectivity problem.",
    recommendation: "Confirm the instance is reachable and the service is still running.",
  },
];

export function interpretLogText(
  stdout: string,
  stderr = ""
): LogInterpretation {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const signals: LogSignal[] = PATTERNS.filter((p) => p.regex.test(combined)).map(
    ({ key, severity, summary, recommendation }) => ({
      key,
      severity,
      summary,
      recommendation,
    })
  );

  if (signals.length === 0) {
    return {
      severity: "info",
      summary:
        combined.trim().length > 0
          ? "No known failure signatures were detected in the logs."
          : "The log output was empty.",
      signals,
      recommendation:
        "Continue tailing the logs or increase the line count if you need more context.",
    };
  }

  return {
    severity: signals.some((s) => s.severity === "error") ? "error" : "warning",
    summary: signals.map((s) => s.summary).join(" "),
    signals,
    recommendation: signals[0].recommendation,
  };
}
