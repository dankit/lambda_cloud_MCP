/**
 * FastMCP `server.start()` options from env.
 * HTTP Stream is for remote clients / tunnels (e.g. Poke); stdio is default for Cursor.
 */

import { resolveMcpHttpSecret } from "./auth";

export type FastMcpResolvedStartOptions =
  | { transportType: "stdio" }
  | {
      transportType: "httpStream";
      httpStream: {
        host: string;
        port: number;
        endpoint: `/${string}`;
        stateless: boolean;
      };
    };

function parsePort(raw: string | undefined, fallback: string): number {
  const port = Number.parseInt((raw ?? fallback).trim(), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid MCP HTTP port "${raw ?? fallback}": expected integer 1–65535 (LAMBDA_MCP_HTTP_PORT or FASTMCP_PORT).`
    );
  }
  return port;
}

function parseStateless(): boolean {
  const v = (
    process.env.LAMBDA_MCP_HTTP_STATELESS ??
    process.env.FASTMCP_STATELESS ??
    ""
  )
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function normalizeEndpoint(raw: string): `/${string}` {
  const t = raw.trim();
  const withSlash = t.startsWith("/") ? t : `/${t}`;
  return withSlash as `/${string}`;
}

/**
 * Reads LAMBDA_MCP_* first, then FastMCP CLI-compatible FASTMCP_*.
 */
export function resolveFastMcpStartOptions(): FastMcpResolvedStartOptions {
  const raw = (
    process.env.LAMBDA_MCP_TRANSPORT ??
    process.env.FASTMCP_TRANSPORT ??
    "stdio"
  )
    .trim()
    .toLowerCase();

  if (
    raw === "" ||
    raw === "stdio" ||
    raw === "stdin" ||
    raw === "ipc"
  ) {
    return { transportType: "stdio" };
  }

  const useHttp =
    raw === "http" ||
    raw === "httpstream" ||
    raw === "http-stream";

  if (!useHttp) {
    throw new Error(
      `Unknown LAMBDA_MCP_TRANSPORT / FASTMCP_TRANSPORT "${process.env.LAMBDA_MCP_TRANSPORT ?? process.env.FASTMCP_TRANSPORT}". Use stdio, http, or httpStream.`
    );
  }

  const port = parsePort(
    process.env.LAMBDA_MCP_HTTP_PORT ?? process.env.FASTMCP_PORT,
    "8080"
  );

  const host = (
    process.env.LAMBDA_MCP_HTTP_HOST ??
    process.env.FASTMCP_HOST ??
    "127.0.0.1"
  ).trim();

  const endpoint = normalizeEndpoint(
    process.env.LAMBDA_MCP_HTTP_PATH ??
      process.env.FASTMCP_ENDPOINT ??
      "/mcp"
  );

  return {
    transportType: "httpStream",
    httpStream: {
      endpoint,
      host,
      port,
      stateless: parseStateless(),
    },
  };
}

/**
 * Logs to stderr so stdio MCP never writes diagnostics on stdout (protocol stream).
 * Stdio mode stays silent here (default `npm run mcp`); HTTP prints host:port + URL
 * plus whether bearer-token auth is enforced (LAMBDA_MCP_HTTP_SECRET).
 */
export function logMcpStartupSummary(opts: FastMcpResolvedStartOptions): void {
  if (opts.transportType === "stdio") {
    return;
  }
  const { host, port, endpoint, stateless } = opts.httpStream;
  const url = `http://${host}:${port}${endpoint}`;
  const mode = stateless ? "stateless" : "session";
  console.error(
    `[lambda-gpu-mcp] Transport: HTTP Stream (${mode}); host:port = ${host}:${port}; MCP URL ${url}`
  );
  if (resolveMcpHttpSecret()) {
    console.error(
      "[lambda-gpu-mcp] Auth: bearer token required (Authorization: Bearer <LAMBDA_MCP_HTTP_SECRET>)."
    );
  } else {
    console.error(
      "[lambda-gpu-mcp] WARNING: HTTP transport is UNAUTHENTICATED. Anyone who can reach this URL " +
        "(including a public tunnel) can run shell on your instances and terminate them. " +
        "Set LAMBDA_MCP_HTTP_SECRET to require a bearer token."
    );
  }
}
