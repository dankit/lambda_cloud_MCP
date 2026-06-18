/**
 * Optional bearer-token auth for the HTTP MCP transport.
 *
 * The HTTP transport is meant to be reached through a public tunnel (e.g. Poke),
 * which means anyone with the URL can call destructive tools (ssh_exec,
 * transfer_file, terminate_instance). When LAMBDA_MCP_HTTP_SECRET is set, every
 * HTTP connection must present `Authorization: Bearer <secret>`. stdio (Cursor)
 * is a local trusted channel and is never gated.
 */

import type http from "node:http";
import { timingSafeEqual } from "node:crypto";

export function resolveMcpHttpSecret(): string | null {
  const raw = process.env.LAMBDA_MCP_HTTP_SECRET?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract the token from an `Authorization: Bearer <token>` header value. */
export function extractBearerToken(
  authorization: string | undefined | null
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : null;
}

/** Constant-time check that the request bearer token matches the secret. */
export function isAuthorized(
  authorization: string | undefined | null,
  secret: string
): boolean {
  const token = extractBearerToken(authorization);
  if (!token) return false;
  return safeEqual(token, secret);
}

export type McpAuthContext = Record<string, unknown>;

/**
 * FastMCP `authenticate` hook. Returns an (empty) auth context to allow the
 * connection, or throws a 401 Response to reject it. Only enforces when a secret
 * is configured; stdio invokes this with `request === undefined`, which we
 * always allow since that channel is local and trusted.
 */
export function createMcpAuthenticate() {
  return async (
    request: http.IncomingMessage | undefined
  ): Promise<McpAuthContext> => {
    if (!request) return {};
    const secret = resolveMcpHttpSecret();
    if (!secret) return {};
    const header = request.headers["authorization"];
    const value = Array.isArray(header) ? header[0] : header;
    if (!isAuthorized(value, secret)) {
      throw new Response(null, { status: 401, statusText: "Unauthorized" });
    }
    return { authed: true };
  };
}
