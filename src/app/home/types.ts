export type Region = { name: string; description?: string };

export type GpuRow = {
  instance_type_name: string;
  description: string;
  gpu_description: string;
  priceUsdPerHour: number;
  vcpus: number;
  memory_gib: number;
  storage_gib: number;
  gpus: number;
  regions_with_capacity_available: Region[];
};

export type SshKey = { id: string; name: string };

export type ConfigStatus = {
  apiKeyConfigured: boolean;
  pemPathConfigured: boolean;
  pemPathFilename: string | null;
  /** Server has `LAMBDA_WATCH_CONFIG_PATH`; MCP/UI can sync watch/snipe JSON to disk. */
  watchConfigSyncConfigured: boolean;
};

/** One watched GPU type with a region to monitor for capacity. */
export type CapacityAlert = {
  instance_type_name: string;
  region_name: string;
};

/** Per GPU type: auto-launch when capacity appears (snipe). */
export type SnipePref = {
  enabled: boolean;
  ssh_key_name: string;
};

export type InstanceDetail = {
  id: string;
  name?: string;
  ip?: string;
  private_ip?: string;
  status?: string;
  hostname?: string;
  jupyter_url?: string;
  region?: { name?: string; description?: string };
  ssh_key_names?: string[];
  /** Lambda instance payload may include nested `instance_type.name`. */
  instance_type_name?: string;
};
