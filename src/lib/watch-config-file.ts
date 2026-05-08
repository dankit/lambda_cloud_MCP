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
