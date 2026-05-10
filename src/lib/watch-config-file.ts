import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseSnipePrefs,
  parseStoredCapacityAlerts,
} from "@/app/home/parsers";
import type { CapacityAlert, SnipePref } from "@/app/home/types";

export type WatchConfigPayload = {
  capacityAlerts: CapacityAlert[];
  snipePrefs: Record<string, SnipePref>;
};

export function parseWatchConfigBody(body: unknown):
  | { ok: true; value: WatchConfigPayload }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Body must be a JSON object." };
  }
  const o = body as Record<string, unknown>;
  const capacityAlerts = parseStoredCapacityAlerts(o.capacityAlerts);
  const snipePrefs = parseSnipePrefs(o.snipePrefs);
  return { ok: true, value: { capacityAlerts, snipePrefs } };
}

export async function readWatchConfigFile(
  absolutePath: string
): Promise<
  | { ok: true; path: string; value: WatchConfigPayload }
  | { ok: false; path: string; error: string }
> {
  try {
    const raw = await fs.readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const inner = parseWatchConfigBody(parsed);
    if (!inner.ok) {
      return {
        ok: false,
        path: absolutePath,
        error: inner.message,
      };
    }
    return { ok: true, path: absolutePath, value: inner.value };
  } catch (e) {
    const code =
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      typeof (e as NodeJS.ErrnoException).code === "string"
        ? (e as NodeJS.ErrnoException).code
        : "";
    if (code === "ENOENT") {
      return {
        ok: true,
        path: absolutePath,
        value: { capacityAlerts: [], snipePrefs: {} },
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, path: absolutePath, error: msg };
  }
}

export async function writeWatchConfigFileAtomic(
  absolutePath: string,
  value: WatchConfigPayload
): Promise<void> {
  const dir = path.dirname(absolutePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.lambda-watch-config.${process.pid}.${Date.now()}.tmp`
  );
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, absolutePath);
}

/** Default path under cwd when unset in development (gitignored `.lambda/`). */
export const DEFAULT_WATCH_CONFIG_RELATIVE_PATH = ".lambda/watch-config.json";

/**
 * Resolved JSON path for watch/snipe persistence.
 * - If `LAMBDA_WATCH_CONFIG_PATH` is set, it wins (resolved relative to cwd when not absolute).
 * - Else in runtime `NODE_ENV=development`, `.lambda/watch-config.json` under cwd.
 * - Else null (explicit path recommended for production deployments with a writable filesystem).
 */
export function resolveWatchConfigPathEnv(): string | null {
  const raw = process.env.LAMBDA_WATCH_CONFIG_PATH?.trim();
  if (raw) return path.resolve(raw);
  if (process.env.NODE_ENV === "development") {
    return path.resolve(process.cwd(), DEFAULT_WATCH_CONFIG_RELATIVE_PATH);
  }
  return null;
}

/** Full GET URL for watch config over HTTP (e.g. http://127.0.0.1:3000/api/watch-config). */
export function resolveWatchHttpUrlEnv(): string | null {
  const raw = process.env.LAMBDA_WATCH_HTTP_URL?.trim();
  if (!raw) return null;
  return raw;
}

/** GET/POST /api/watch-config are allowed (dev by default; prod requires flag). */
export function watchConfigHttpSyncAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.LAMBDA_WATCH_ALLOW_SYNC === "true";
}

/**
 * Secret MCP sends as `x-lambda-watch-sync-secret` when calling `LAMBDA_WATCH_HTTP_URL`.
 * Mirrors optional `LAMBDA_WATCH_HTTP_SYNC_SECRET`, otherwise `LAMBDA_WATCH_CONFIG_SYNC_SECRET`.
 */
export function resolveWatchHttpClientSecretEnv(): string | null {
  const direct = process.env.LAMBDA_WATCH_HTTP_SYNC_SECRET?.trim();
  if (direct) return direct;
  const shared = process.env.LAMBDA_WATCH_CONFIG_SYNC_SECRET?.trim();
  return shared ?? null;
}

export type LoadedWatchConfigForMcp =
  | {
      ok: true;
      source: "http";
      url: string;
      value: WatchConfigPayload;
    }
  | {
      ok: false;
      source: "unset";
      message: string;
    }
  | {
      ok: false;
      source: "http";
      url: string;
      error: string;
      httpStatus?: number;
    };

/**
 * Resolve watch/snipe prefs for MCP via GET `LAMBDA_WATCH_HTTP_URL` only (e.g. Next
 * `/api/watch-config`). Next persists JSON on disk (`LAMBDA_WATCH_CONFIG_PATH` or dev
 * default `.lambda/watch-config.json`); MCP does not open that path.
 */
export async function loadWatchConfigForMcp(): Promise<LoadedWatchConfigForMcp> {
  const httpUrl = resolveWatchHttpUrlEnv();
  if (!httpUrl) {
    return {
      ok: false,
      source: "unset",
      message:
        "LAMBDA_WATCH_HTTP_URL is not set. Point it at your running app, e.g. http://127.0.0.1:3000/api/watch-config.",
    };
  }

  const secret = resolveWatchHttpClientSecretEnv();
  try {
    const headers: HeadersInit = {};
    if (secret) headers["x-lambda-watch-sync-secret"] = secret;
    const res = await fetch(httpUrl, { headers });
    let bodyJson: unknown;
    try {
      bodyJson = (await res.json()) as unknown;
    } catch {
      return {
        ok: false,
        source: "http",
        url: httpUrl,
        error: "Response body is not JSON.",
        httpStatus: res.status,
      };
    }
    const o =
      bodyJson && typeof bodyJson === "object"
        ? (bodyJson as Record<string, unknown>)
        : {};
    if (!res.ok) {
      const err =
        typeof o.error === "string" ? o.error : `${res.status} ${res.statusText}`;
      return {
        ok: false,
        source: "http",
        url: httpUrl,
        error: err,
        httpStatus: res.status,
      };
    }
    if (o.ok !== true) {
      const err =
        typeof o.error === "string"
          ? o.error
          : "GET /api/watch-config returned ok:false.";
      return {
        ok: false,
        source: "http",
        url: httpUrl,
        error: err,
        httpStatus: res.status,
      };
    }
    const inner = parseWatchConfigBody(o);
    if (!inner.ok) {
      return {
        ok: false,
        source: "http",
        url: httpUrl,
        error: inner.message,
        httpStatus: res.status,
      };
    }
    return { ok: true, source: "http", url: httpUrl, value: inner.value };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, source: "http", url: httpUrl, error: msg };
  }
}
