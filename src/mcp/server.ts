/**
 * FastMCP server for Lambda Cloud repo operations.
 * Run: `npm run mcp` with LAMBDA_API_KEY and SSH env configured.
 */

import { FastMCP, type Logger } from "fastmcp";
import {
  logMcpStartupSummary,
  resolveFastMcpStartOptions,
} from "./start-transport";
import { bootstrapMcpProcessEnv, preflightMcpEnv } from "./runtime";
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

/** `LAMBDA_MCP_DEBUG_TOOLS=true` → stderr-log every tool call (args + result + ms). */
function isToolDebugEnabled(): boolean {
  const v = (process.env.LAMBDA_MCP_DEBUG_TOOLS ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function previewJson(value: unknown, max = 1500): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (typeof text !== "string") text = String(text);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[+${text.length - max} chars]`;
}

/** Tools return ContentResult `{ content: [{type:"text",text}] }`; surface the text. */
function unwrapToolResult(result: unknown): unknown {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    const first = (result as { content: unknown[] }).content[0];
    if (
      first &&
      typeof first === "object" &&
      "type" in first &&
      (first as { type: unknown }).type === "text" &&
      "text" in first
    ) {
      return (first as { text: unknown }).text;
    }
  }
  return result;
}

/**
 * Monkey-patches `server.addTool` so every subsequently registered tool's
 * execute is wrapped to log `→ name args=…`, `← name Nms result=…`, and
 * `✗ name Nms error=…` on stderr. stderr is the only safe channel under stdio
 * MCP (stdout carries the JSON-RPC stream). Call BEFORE `register*` helpers.
 */
function installToolCallLogger(server: FastMCP): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = server.addTool.bind(server) as (tool: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as unknown as { addTool: (tool: any) => void }).addTool = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: any
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userExecute = tool.execute as (a: any, c: any) => Promise<unknown>;
    const wrapped = {
      ...tool,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any, ctx: any) => {
        const started = Date.now();
        console.error(
          `[mcp:tool] → ${tool.name} args=${previewJson(args)}`
        );
        try {
          const result = await userExecute(args, ctx);
          const ms = Date.now() - started;
          console.error(
            `[mcp:tool] ← ${tool.name} ${ms}ms result=${previewJson(unwrapToolResult(result))}`
          );
          return result;
        } catch (err) {
          const ms = Date.now() - started;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[mcp:tool] ✗ ${tool.name} ${ms}ms error=${msg}`);
          throw err;
        }
      },
    };
    original(wrapped);
  };
}

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
preflightMcpEnv();

const server = new FastMCP({
  name: "lambda-gpu-availability",
  version: "0.3.0",
  logger: createStdioMcpLogger(),
});

if (isToolDebugEnabled()) {
  installToolCallLogger(server);
  console.error(
    "[lambda-gpu-mcp] Tool call debug logging enabled (LAMBDA_MCP_DEBUG_TOOLS)."
  );
}

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
