/**
 * MCP setup copy text and API payload shape (shared by GET /api/mcp-setup-hints).
 */

export type McpSetupHintsPayload = {
  suggestedWatchHttpUrl: string;
  syncSecretRequired: boolean;
  watchConfigPathResolved: boolean;
  watchConfigHttpSyncAllowed: boolean;
  /** GET /api/watch-config should succeed under same guards as MCP (path + HTTP policy). */
  watchConfigGetLikelyWorks: boolean;
  apiKeyConfigured: boolean;
  pemPathConfigured: boolean;
  pemPathFilename: string | null;
  mcpDotenvSnippet: string;
  uiOverridesNote: string;
};

export function buildMcpDotenvSnippet(opts: {
  suggestedWatchHttpUrl: string;
  syncSecretRequired: boolean;
}): string {
  const lines: string[] = [
    "# Paste into MCP server env or your shell before `npm run mcp`.",
    "# MCP runs in a separate process — UI Settings overrides do not apply.",
    "",
    "# Optional: single file — set in shell/Cursor MCP env only (not inside .env):",
    "# LAMBDA_DOTENV_PATH=.env",
    "# Default: .env.local then .env from repo root (set MCP cwd to this project)",
    "",
    "# Required for Lambda HTTP tools:",
    "LAMBDA_API_KEY=<paste-from-.env-local>",
    "",
    "# SSH for lambda_ssh_exec:",
    "LAMBDA_SSH_PEM_PATH=<absolute-path-to-key.pem>",
    "",
    `# Watch/snipe file (same as MCP GET endpoint):`,
    `LAMBDA_WATCH_HTTP_URL=${opts.suggestedWatchHttpUrl}`,
    "",
  ];

  if (opts.syncSecretRequired) {
    lines.push(
      "# Next has LAMBDA_WATCH_CONFIG_SYNC_SECRET — MCP sends this header on GET:",
      "LAMBDA_WATCH_HTTP_SYNC_SECRET=<same-secret-as-NEXT>"
    );
  } else {
    lines.push(
      "# Watch sync secret: leave unset unless LAMBDA_WATCH_CONFIG_SYNC_SECRET is set in Next."
    );
  }

  lines.push(
    "",
    "# Optional — HTTP Stream for Poke/tunnel (default is stdio for Cursor):",
    "# LAMBDA_MCP_TRANSPORT=http",
    "# LAMBDA_MCP_HTTP_PORT=8080",
    "# LAMBDA_MCP_HTTP_HOST=127.0.0.1",
    "# LAMBDA_MCP_HTTP_PATH=/mcp",
    "",
    "# Optional MCP SSH tuning:",
    "# LAMBDA_SSH_USER=ubuntu",
    "# LAMBDA_SSH_PORT=22",
    "# LAMBDA_SSH_TIMEOUT_MS=120000",
    "# MCP_ENV_SETUP_COMMAND=<see docs/mcp-ssh-training-hints.md>",
    ""
  );

  return lines.join("\n");
}
