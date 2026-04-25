/** Lambda instance status strings vary; treat as terminating when shutdown is in progress. */
export function isInstanceTerminatingLike(
  status: string | undefined
): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes("terminating") ||
    s.includes("terminated") ||
    s.includes("shutting")
  );
}

export function publicIpDisplay(inst: {
  ip?: string;
  status?: string;
}): string {
  if (inst.ip) return inst.ip;
  if (isInstanceTerminatingLike(inst.status)) return "—";
  return "… provisioning";
}
