/**
 * Per-instance logical SSH session state held in the MCP process memory.
 *
 * A live persistent shell (ssh ControlMaster) is unreliable on the Windows host
 * this server targets, so instead we remember the last working directory and the
 * accumulated environment for each instance and replay them as `cd …` / `export …`
 * on every command (see composeRemoteScript in lib/mcp-ssh). Agents get continuity
 * without re-stating context each call.
 */

export type SshSession = {
  workdir?: string;
  env?: Record<string, string>;
};

export type SessionUpdate = {
  workdir?: string;
  env?: Record<string, string>;
  /** Clear stored state for this instance before applying the update. */
  reset?: boolean;
};

const sessions = new Map<string, SshSession>();

export function getSession(instanceId: string): SshSession {
  return sessions.get(instanceId) ?? {};
}

export function resetSession(instanceId: string): void {
  sessions.delete(instanceId);
}

/** Clears all sessions (test helper). */
export function clearAllSessions(): void {
  sessions.clear();
}

/**
 * Merge an update into the stored session and return the resulting state.
 * `workdir` replaces the previous value; `env` keys are merged over existing
 * ones. With `reset: true` the prior state is dropped first.
 */
export function mergeSession(
  instanceId: string,
  update: SessionUpdate
): SshSession {
  if (update.reset) sessions.delete(instanceId);
  const current = sessions.get(instanceId) ?? {};
  const next: SshSession = { ...current };
  if (update.workdir !== undefined && update.workdir.trim().length > 0) {
    next.workdir = update.workdir;
  }
  if (update.env && Object.keys(update.env).length > 0) {
    next.env = { ...(current.env ?? {}), ...update.env };
  }
  sessions.set(instanceId, next);
  return next;
}
