/**
 * FastMCP server for Lambda Cloud repo operations.
 * Run: `npm run mcp` with LAMBDA_API_KEY and SSH env configured.
 */

import { FastMCP } from "fastmcp";
import { bootstrapMcpProcessEnv } from "./runtime";
import {
  registerEditFileTool,
  registerGetStatusTool,
  registerSetupEnvTool,
  registerStartRunTool,
  registerStopRunTool,
  registerSyncRepoTool,
} from "./tools";

bootstrapMcpProcessEnv();

const server = new FastMCP({
  name: "lambda-gpu-availability",
  version: "0.2.0",
});

registerSetupEnvTool(server);
registerSyncRepoTool(server);
registerGetStatusTool(server);
registerStartRunTool(server);
registerStopRunTool(server);
registerEditFileTool(server);

await server.start({ transportType: "stdio" });
