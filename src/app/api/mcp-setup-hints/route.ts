import { NextRequest, NextResponse } from "next/server";
import { envConfigSnapshot } from "@/lib/credentials";
import {
  buildMcpDotenvSnippet,
  type McpSetupHintsPayload,
} from "@/lib/mcp-setup-hints";
import {
  resolveWatchConfigPathEnv,
  watchConfigHttpSyncAllowed,
} from "@/lib/watch-config-file";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const suggestedWatchHttpUrl = `${origin}/api/watch-config`;
  const syncSecretRequired = Boolean(
    process.env.LAMBDA_WATCH_CONFIG_SYNC_SECRET?.trim()
  );

  const watchConfigPathResolved = Boolean(resolveWatchConfigPathEnv());
  const httpAllowed = watchConfigHttpSyncAllowed();
  const snapshot = envConfigSnapshot();

  const payload: McpSetupHintsPayload = {
    suggestedWatchHttpUrl,
    syncSecretRequired,
    watchConfigPathResolved,
    watchConfigHttpSyncAllowed: httpAllowed,
    watchConfigGetLikelyWorks: watchConfigPathResolved && httpAllowed,
    apiKeyConfigured: snapshot.apiKeyConfigured,
    pemPathConfigured: snapshot.pemPathConfigured,
    pemPathFilename: snapshot.pemPathFilename,
    mcpDotenvSnippet: buildMcpDotenvSnippet({
      suggestedWatchHttpUrl,
      syncSecretRequired,
    }),
    uiOverridesNote:
      "Optional API key / PEM overrides in Settings apply only to this app’s APIs, not to the MCP process.",
  };

  return NextResponse.json(payload);
}
