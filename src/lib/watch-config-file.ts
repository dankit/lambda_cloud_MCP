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
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, path: absolutePath, error: msg };
  }
}

export async function writeWatchConfigFileAtomic(
  absolutePath: string,
  value: WatchConfigPayload
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const tmp = path.join(
    dir,
    `.lambda-watch-config.${process.pid}.${Date.now()}.tmp`
  );
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, absolutePath);
}

/** Resolve env path relative to cwd when not absolute (Node `path.resolve` rules). */
export function resolveWatchConfigPathEnv(): string | null {
  const raw = process.env.LAMBDA_WATCH_CONFIG_PATH?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

/** Full GET URL for watch config over HTTP (e.g. http://127.0.0.1:3000/api/watch-config). */
export function resolveWatchHttpUrlEnv(): string | null {
  const raw = process.env.LAMBDA_WATCH_HTTP_URL?.trim();
  if (!raw) return null;
  return raw;
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
      ok: true;
      source: "file";
      path: string;
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
    }
  | {
      ok: false;
      source: "file";
      path: string;
      error: string;
    };

/**
 * Resolve watch/snipe prefs for MCP: prefers `LAMBDA_WATCH_HTTP_URL` (GET) over disk at
 * `LAMBDA_WATCH_CONFIG_PATH`.
 */
export async function loadWatchConfigForMcp(): Promise<LoadedWatchConfigForMcp> {
  const httpUrl = resolveWatchHttpUrlEnv();
  if (httpUrl) {
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

  const pathStr = resolveWatchConfigPathEnv();
  if (!pathStr) {
    return {
      ok: false,
      source: "unset",
      message:
        "Neither LAMBDA_WATCH_HTTP_URL nor LAMBDA_WATCH_CONFIG_PATH is set. Configure one of them for watch/snipe data.",
    };
  }
  const read = await readWatchConfigFile(pathStr);
  if (!read.ok) {
    return {
      ok: false,
      source: "file",
      path: read.path,
      error: read.error,
    };
  }
  return { ok: true, source: "file", path: read.path, value: read.value };
}
