import { NextRequest, NextResponse } from "next/server";
import {
  parseWatchConfigBody,
  readWatchConfigFile,
  resolveWatchConfigPathEnv,
  writeWatchConfigFileAtomic,
} from "@/lib/watch-config-file";

function syncAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.LAMBDA_WATCH_ALLOW_SYNC === "true";
}

function secretOk(req: NextRequest): boolean {
  const expected = process.env.LAMBDA_WATCH_CONFIG_SYNC_SECRET?.trim();
  if (!expected) return true;
  const got =
    req.headers.get("x-lambda-watch-sync-secret")?.trim() ?? "";
  return got === expected;
}

export async function GET(req: NextRequest) {
  const configPath = resolveWatchConfigPathEnv();
  if (!configPath) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "LAMBDA_WATCH_CONFIG_PATH is not configured on this server.",
      },
      { status: 503 }
    );
  }
  if (!syncAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Watch config read disabled. Use NODE_ENV=development or set LAMBDA_WATCH_ALLOW_SYNC=true.",
      },
      { status: 403 }
    );
  }
  if (!secretOk(req)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing x-lambda-watch-sync-secret." },
      { status: 401 }
    );
  }

  const read = await readWatchConfigFile(configPath);
  if (!read.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: read.error,
        path: read.path,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    path: configPath,
    capacityAlerts: read.value.capacityAlerts,
    snipePrefs: read.value.snipePrefs,
  });
}

export async function POST(req: NextRequest) {
  const configPath = resolveWatchConfigPathEnv();
  if (!configPath) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "LAMBDA_WATCH_CONFIG_PATH is not configured on this server.",
      },
      { status: 503 }
    );
  }
  if (!syncAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Watch config sync disabled. Use NODE_ENV=development or set LAMBDA_WATCH_ALLOW_SYNC=true.",
      },
      { status: 403 }
    );
  }
  if (!secretOk(req)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing x-lambda-watch-sync-secret." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 }
    );
  }

  const parsed = parseWatchConfigBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.message }, {
      status: 400,
    });
  }

  try {
    await writeWatchConfigFileAtomic(configPath, parsed.value);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    path: configPath,
  });
}
