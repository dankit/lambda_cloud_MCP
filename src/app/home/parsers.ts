import type {
  CapacityAlert,
  GpuRow,
  InstanceDetail,
  Region,
  SshKey,
  SnipePref,
} from "./types";

export function parseSnipePrefs(raw: unknown): Record<string, SnipePref> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, SnipePref> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[k] = {
      enabled: o.enabled === true,
      ssh_key_name: typeof o.ssh_key_name === "string" ? o.ssh_key_name : "",
    };
  }
  return out;
}

/** Migrate legacy `string[]` of instance type names to alert objects. */
export function parseStoredCapacityAlerts(raw: unknown): CapacityAlert[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 0 && typeof raw[0] === "string") {
    return raw
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .map((instance_type_name) => ({ instance_type_name, region_name: "" }));
  }
  const out: CapacityAlert[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const instance_type_name =
      typeof o.instance_type_name === "string" ? o.instance_type_name : "";
    if (!instance_type_name) continue;
    const region_name =
      typeof o.region_name === "string" ? o.region_name : "";
    out.push({ instance_type_name, region_name });
  }
  return out;
}

export function parseRegions(payload: unknown): Region[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((r): Region | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as { name?: string; description?: string };
      if (typeof o.name !== "string" || !o.name) return null;
      const out: Region = { name: o.name };
      if (typeof o.description === "string") out.description = o.description;
      return out;
    })
    .filter((x): x is Region => x !== null);
}

export function hasCapacity(row: GpuRow): boolean {
  return row.regions_with_capacity_available.length > 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if capacity is in this zone or matches parent scope (e.g. us-east-2 under us-east). */
export function regionMatchesWatchScope(
  capacityRegionName: string,
  watchScope: string
): boolean {
  const w = watchScope.trim();
  const c = capacityRegionName.trim();
  if (!w) return false;
  if (c === w) return true;
  return new RegExp(`^${escapeRegex(w)}-\\d+$`).test(c);
}

export function hasCapacityInWatchScope(row: GpuRow, watchScope: string): boolean {
  const w = watchScope.trim();
  if (w === "") return hasCapacity(row);
  return row.regions_with_capacity_available.some((x) =>
    regionMatchesWatchScope(x.name, w)
  );
}

export function firstCapacityRegionInWatchScope(
  row: GpuRow,
  watchScope: string
): string | undefined {
  const w = watchScope.trim();
  if (!w) return row.regions_with_capacity_available[0]?.name;
  for (const r of row.regions_with_capacity_available) {
    if (regionMatchesWatchScope(r.name, w)) return r.name;
  }
  return undefined;
}

export type WatchRegionGroup = {
  label: string;
  options: { value: string; label: string }[];
};

/**
 * Groups API regions for the watch dropdown: numeric zones under a shared parent
 * (e.g. us-east-1, us-east-2 under us-east) plus an "All parent (any zone)" option.
 */
export function buildWatchRegionSelectGroups(regions: Region[]): WatchRegionGroup[] {
  const parentsWithZones = new Set<string>();
  for (const r of regions) {
    const p = r.name.replace(/-\d+$/, "");
    if (p !== r.name) parentsWithZones.add(p);
  }

  const assigned = new Set<string>();
  const groups: WatchRegionGroup[] = [];

  for (const parent of [...parentsWithZones].sort((a, b) =>
    a.localeCompare(b)
  )) {
    const members = regions
      .filter(
        (r) =>
          r.name === parent ||
          new RegExp(`^${escapeRegex(parent)}-\\d+$`).test(r.name)
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const m of members) assigned.add(m.name);

    const options: { value: string; label: string }[] = [
      { value: parent, label: `All ${parent} (any zone)` },
    ];
    for (const m of members) {
      if (m.name === parent) continue;
      const label = m.description ? `${m.name} — ${m.description}` : m.name;
      options.push({ value: m.name, label });
    }
    groups.push({ label: parent, options });
  }

  const unassigned = regions
    .filter((r) => !assigned.has(r.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (unassigned.length > 0) {
    groups.push({
      label: "Other regions",
      options: unassigned.map((m) => ({
        value: m.name,
        label: m.description ? `${m.name} — ${m.description}` : m.name,
      })),
    });
  }

  return groups;
}

export function watchRegionSelectValueSet(groups: WatchRegionGroup[]): Set<string> {
  const s = new Set<string>();
  for (const g of groups) {
    for (const o of g.options) s.add(o.value);
  }
  return s;
}

export function parseInstanceDetail(raw: unknown): InstanceDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : undefined,
    ip: typeof o.ip === "string" ? o.ip : undefined,
    private_ip: typeof o.private_ip === "string" ? o.private_ip : undefined,
    status: typeof o.status === "string" ? o.status : undefined,
    hostname: typeof o.hostname === "string" ? o.hostname : undefined,
    jupyter_url: typeof o.jupyter_url === "string" ? o.jupyter_url : undefined,
    region:
      o.region && typeof o.region === "object"
        ? (o.region as { name?: string; description?: string })
        : undefined,
    ssh_key_names: Array.isArray(o.ssh_key_names)
      ? o.ssh_key_names.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

export function parseInstancesListPayload(payload: unknown): InstanceDetail[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data
      .map(parseInstanceDetail)
      .filter((x): x is InstanceDetail => x !== null);
  }
  if (data && typeof data === "object" && "instances" in data) {
    const inst = (data as { instances?: unknown }).instances;
    if (Array.isArray(inst)) {
      return inst
        .map(parseInstanceDetail)
        .filter((x): x is InstanceDetail => x !== null);
    }
  }
  return [];
}

export function parseGpuRows(payload: unknown): GpuRow[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return [];
  const out: GpuRow[] = [];
  for (const item of Object.values(data as Record<string, unknown>)) {
    if (!item || typeof item !== "object") continue;
    const inst = (item as { instance_type?: unknown }).instance_type;
    const regions = (item as { regions_with_capacity_available?: Region[] })
      .regions_with_capacity_available;
    if (!inst || typeof inst !== "object") continue;
    const o = inst as {
      name?: string;
      description?: string;
      gpu_description?: string;
      price_cents_per_hour?: number;
      specs?: {
        vcpus?: number;
        memory_gib?: number;
        storage_gib?: number;
        gpus?: number;
      };
    };
    const gpus = o.specs?.gpus ?? 0;
    if (gpus <= 0 || !o.name) continue;
    const cents = o.price_cents_per_hour ?? 0;
    out.push({
      instance_type_name: o.name,
      description: o.description ?? "",
      gpu_description: o.gpu_description ?? "",
      priceUsdPerHour: cents / 100,
      vcpus: o.specs?.vcpus ?? 0,
      memory_gib: o.specs?.memory_gib ?? 0,
      storage_gib: o.specs?.storage_gib ?? 0,
      gpus,
      regions_with_capacity_available: Array.isArray(regions) ? regions : [],
    });
  }
  return out;
}

export function parseSshKeys(payload: unknown): SshKey[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((k) => {
      if (!k || typeof k !== "object") return null;
      const o = k as { id?: string; name?: string };
      if (!o.id || !o.name) return null;
      return { id: o.id, name: o.name };
    })
    .filter((x): x is SshKey => x !== null);
}

export function formatError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Request failed.";
  const err = (payload as { error?: { code?: string; message?: string } }).error;
  if (!err) return "Request failed.";
  const code = err.code ? `[${err.code}] ` : "";
  return `${code}${err.message ?? "Unknown error"}`;
}
