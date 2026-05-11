/**
 * FastMCP server for Lambda Cloud repo operations.
 * Run: `npm run mcp` with LAMBDA_API_KEY and SSH env configured.
 */

import { FastMCP, type Logger } from "fastmcp";
import {
  logMcpStartupSummary,
  resolveFastMcpStartOptions,
} from "./start-transport";
import { bootstrapMcpProcessEnv } from "./runtime";
import {
  registerEditFileTool,
  registerGetStatusTool,
  registerGetUiSettingsTool,
  registerReadFileTool,
  registerSetupTrainingEnvironmentTool,
  registerSshExecTool,
  registerStartRunTool,
  registerStopTrainingTool,
  registerTailLogsTool,
  registerTerminateInstanceTool,
} from "./tools";

/**
 * Interactive shells (TTY stdin) are not MCP clients, so FastMCP never sees
 * initialize/capabilities and logs a noisy warning. Real hosts (e.g. Cursor)
 * use a pipe, so we only filter in the TTY case.
 */
function createStdioMcpLogger(): Logger {
  const skipCapabilitiesWarning =
    typeof process.stdin !== "undefined" && process.stdin.isTTY === true;

  return {
    debug: (...args: unknown[]) => console.debug(...args),
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => {
      if (skipCapabilitiesWarning) {
        const first = args[0];
        if (
          typeof first === "string" &&
          first.includes("could not infer client capabilities")
        ) {
          return;
        }
      }
      console.warn(...args);
    },
  };
}

bootstrapMcpProcessEnv();

const server = new FastMCP({
  name: "lambda-gpu-availability",
  version: "0.3.0",
  logger: createStdioMcpLogger(),
});

registerGetStatusTool(server);
registerGetUiSettingsTool(server);
registerSetupTrainingEnvironmentTool(server);
registerStartRunTool(server);
registerStopTrainingTool(server);
registerTailLogsTool(server);
registerReadFileTool(server);
registerEditFileTool(server);
registerSshExecTool(server);
registerTerminateInstanceTool(server);

const startOpts = resolveFastMcpStartOptions();
logMcpStartupSummary(startOpts);
void server.start(startOpts).catch((err) => {
  console.error(err);
  process.exit(1);
});
