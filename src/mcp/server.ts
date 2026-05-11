/**
 * FastMCP server for Lambda Cloud repo operations.
 * Run: `npm run mcp` with LAMBDA_API_KEY and SSH env configured.
 */

import { FastMCP } from "fastmcp";
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

bootstrapMcpProcessEnv();

const server = new FastMCP({
  name: "lambda-gpu-availability",
  version: "0.3.0",
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

await server.start({ transportType: "stdio" });
