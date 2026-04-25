/** Minimum GPU capacity poll interval (seconds). */
export const MIN_POLL_SECONDS = 2;
export const DEFAULT_POLL_SECONDS = 5;

/** Shown when Lambda returns HTTP 429 on a proxied API call. */
export const LAMBDA_RATE_LIMIT_ALERT = "rate limit triggered by lambda";

/** Instance list: separate from capacity polling; keep conservative for Lambda rate limits (~1 req/s account-wide). */
export const INSTANCE_LIST_POLL_MS = 15_000;

/** When fast GPU table polling is paused (running instance / launch), still refresh instance types slowly so capacity alerts/snipe can see new stock. */
export const PAUSED_CAPACITY_ALERT_POLL_MS = 45_000;

export const ALERT_STORAGE_KEY = "lambda_gpu_capacity_alert_types";
export const SNIPE_PREFS_STORAGE_KEY = "lambda_gpu_snipe_prefs";
export const SETTINGS_PANEL_ID = "settings-panel-fields";
export const ALERTS_PANEL_ID = "setup-alerts-panel-fields";
export const TEST_ALERT_MS = 3_600;
export const LAUNCH_COOLDOWN_MS = 12_000;

export const SSH_USER = "ubuntu";
export const SSH_PORT = 22;
