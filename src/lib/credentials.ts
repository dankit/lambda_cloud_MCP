import path from "node:path";
import { resolveWatchConfigPathEnv } from "./watch-config-file";

export type ApiKeySource = "header" | "env" | "none";

export function resolveApiKey(headerValue: string | null): {
  key: string | null;
  source: ApiKeySource;
} {
  const trimmed = headerValue?.trim();
  if (trimmed) return { key: trimmed, source: "header" };
  const env = process.env.LAMBDA_API_KEY?.trim();
  if (env) return { key: env, source: "env" };
  return { key: null, source: "none" };
}

export function resolvePemPath(headerValue: string | null): {
  path: string | null;
  source: "header" | "env" | "none";
} {
  const trimmed = headerValue?.trim();
  if (trimmed) return { path: trimmed, source: "header" };
  const env = process.env.LAMBDA_SSH_PEM_PATH?.trim();
  if (env) return { path: env, source: "env" };
  return { path: null, source: "none" };
}

export function pemFilenameHint(pemPath: string): string {
  return path.basename(pemPath);
}

export function envConfigSnapshot() {
  const apiKey = Boolean(process.env.LAMBDA_API_KEY?.trim());
  const pemPathRaw = process.env.LAMBDA_SSH_PEM_PATH?.trim();
  const pemPath = Boolean(pemPathRaw);
  const watchConfigured = Boolean(resolveWatchConfigPathEnv());
  return {
    apiKeyConfigured: apiKey,
    pemPathConfigured: pemPath,
    pemPathFilename: pemPathRaw ? pemFilenameHint(pemPathRaw) : null,
    watchConfigSyncConfigured: watchConfigured,
  };
}
