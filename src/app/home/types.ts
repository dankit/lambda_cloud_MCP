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
};
