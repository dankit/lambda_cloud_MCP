/**
 * Pure builders for remote background-job scripts. A "job" is a detached process
 * started with `setsid` whose pid, return code, and combined output live under
 * ~/.lambda-mcp/jobs/<jobId>.{pid,rc,log} on the instance. This lets long runs
 * (e.g. training) outlive the per-command SSH timeout: start once, then poll.
 *
 * These functions only build shell text; execution happens via runCommandOnInstance.
 */

import { shellSingleQuoteValue } from "./command-template";

const JOBS_DIR = '"$HOME/.lambda-mcp/jobs"';
const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const MAX_JOB_LOG_LINES = 5000;

export type JobSignal = "INT" | "TERM" | "KILL";

/** Filesystem-safe, collision-resistant id (only [a-z0-9-], safe to interpolate). */
export function newJobId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `job-${ts}-${rand}`;
}

function assertJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      "Invalid job id (allowed characters: letters, numbers, '-', '_')."
    );
  }
}

/**
 * Launch `command` detached. The inner shell records the command's own exit code
 * to <jobId>.rc when it finishes; stdout+stderr stream to <jobId>.log. Prints the
 * jobId on success. Any cd/export prefix added by composeRemoteScript wraps this
 * whole script, so the detached child inherits that workdir and environment.
 */
export function buildBackgroundJobScript(params: {
  jobId: string;
  command: string;
}): string {
  assertJobId(params.jobId);
  const { jobId, command } = params;
  const inner = `${command}; echo $? > "$HOME/.lambda-mcp/jobs/${jobId}.rc"`;
  return [
    `d=${JOBS_DIR}`,
    'mkdir -p "$d"',
    `setsid bash -lc ${shellSingleQuoteValue(inner)} > "$d/${jobId}.log" 2>&1 &`,
    `echo $! > "$d/${jobId}.pid"`,
    `printf '%s %s\\n' ${shellSingleQuoteValue(jobId)} "$!"`,
  ].join("\n");
}

/** Parse the `<jobId> <pid>` line printed by buildBackgroundJobScript. */
export function parseBackgroundStartOutput(
  stdout: string
): { jobId: string | null; pid: string | null } {
  const line = stdout.trim().split("\n").pop()?.trim() ?? "";
  const [jobId, pid] = line.split(/\s+/);
  return {
    jobId: jobId && jobId.length > 0 ? jobId : null,
    pid: pid && pid.length > 0 ? pid : null,
  };
}

/**
 * Report liveness (kill -0 on the recorded pid), the exit code if the job has
 * finished, and a bounded tail of the log. Output format: leading `key=value`
 * lines, a `---LOG---` separator, then the raw log tail (parsed by job_status).
 */
export function buildJobStatusScript(jobId: string, lines: number): string {
  assertJobId(jobId);
  const n = Math.min(Math.max(1, Math.floor(lines)), MAX_JOB_LOG_LINES);
  return [
    `d=${JOBS_DIR}`,
    `pidfile="$d/${jobId}.pid"`,
    `rcfile="$d/${jobId}.rc"`,
    `logfile="$d/${jobId}.log"`,
    'if [ ! -f "$pidfile" ]; then',
    '  printf "found=0\\nrunning=0\\npid=\\nexitcode=\\nlogpath=\\n---LOG---\\n"; exit 0',
    "fi",
    'pid=$(tr -d "[:space:]" < "$pidfile")',
    'printf "found=1\\npid=%s\\n" "$pid"',
    'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then printf "running=1\\n"; else printf "running=0\\n"; fi',
    'if [ -f "$rcfile" ]; then printf "exitcode=%s\\n" "$(tr -d "[:space:]" < "$rcfile")"; else printf "exitcode=\\n"; fi',
    'printf "logpath=%s\\n" "$logfile"',
    'printf "%s\\n" "---LOG---"',
    `if [ -f "$logfile" ]; then tail -n ${n} "$logfile"; fi`,
  ].join("\n");
}

/**
 * Signal the detached job's process group (setsid makes the pid a group leader),
 * falling back to the single pid. Defaults to TERM.
 */
export function buildJobSignalScript(
  jobId: string,
  signal: JobSignal = "TERM"
): string {
  assertJobId(jobId);
  return [
    `d=${JOBS_DIR}`,
    `pidfile="$d/${jobId}.pid"`,
    'if [ ! -f "$pidfile" ]; then echo "pid file missing for job" >&2; exit 1; fi',
    'pid=$(tr -d "[:space:]" < "$pidfile")',
    'if [ -z "$pid" ]; then echo "pid file empty" >&2; exit 1; fi',
    `kill -${signal} -"$pid" 2>/dev/null || kill -${signal} "$pid" 2>/dev/null || true`,
    `printf 'signaled %s with ${signal}\\n' "$pid"`,
  ].join("\n");
}

export type ParsedJobStatus = {
  found: boolean;
  running: boolean;
  pid: string | null;
  exitCode: number | null;
  logPath: string | null;
  logTail: string;
};

/** Parse the stdout produced by buildJobStatusScript. */
export function parseJobStatusOutput(stdout: string): ParsedJobStatus {
  const sepIndex = stdout.indexOf("---LOG---");
  const head = sepIndex >= 0 ? stdout.slice(0, sepIndex) : stdout;
  const logTail =
    sepIndex >= 0 ? stdout.slice(sepIndex + "---LOG---".length).replace(/^\n/, "") : "";
  const fields = new Map<string, string>();
  for (const line of head.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const exitRaw = fields.get("exitcode") ?? "";
  const exitNum = exitRaw.length > 0 ? Number(exitRaw) : NaN;
  const pid = fields.get("pid") ?? "";
  const logPath = fields.get("logpath") ?? "";
  return {
    found: fields.get("found") === "1",
    running: fields.get("running") === "1",
    pid: pid.length > 0 ? pid : null,
    exitCode: Number.isFinite(exitNum) ? exitNum : null,
    logPath: logPath.length > 0 ? logPath : null,
    logTail,
  };
}
