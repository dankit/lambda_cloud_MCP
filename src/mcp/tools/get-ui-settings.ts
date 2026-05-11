import type { FastMCP } from "fastmcp";
import * as z from "zod";
import { jsonToolResult } from "../json-tool-result";
import { loadWatchConfigForMcp } from "../../lib/watch-config-file";

export function registerGetUiSettingsTool(server: FastMCP): void {
  server.addTool({
    name: "get_ui_settings",
    description:
      "Return watch/snipe UI configuration from LAMBDA_WATCH_HTTP_URL (capacity alerts and auto-launch/snipe per GPU type). Does not list Lambda instances — use get_status for that.",
    parameters: z.object({}),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      title: "get_ui_settings",
    },
    execute: async () => {
      const watch = await loadWatchConfigForMcp();
      const watchHttpConfigured = Boolean(
        process.env.LAMBDA_WATCH_HTTP_URL?.trim().length
      );

      if (!watch.ok) {
        return jsonToolResult({
          ok: false,
          tool: "get_ui_settings",
          watchHttpConfigured,
          environment: {
            lambdaWatchHttpUrlPresent: watchHttpConfigured,
            lambdaWatchConfigPathNote:
              "MCP reads watch/snipe only via LAMBDA_WATCH_HTTP_URL (Next serves the JSON file).",
          },
          watch,
        });
      }

      const snipeEnabledGpuTypes = Object.entries(watch.value.snipePrefs)
        .filter(([, pref]) => pref.enabled)
        .map(([instance_type_name]) => instance_type_name);

      return jsonToolResult({
        ok: true,
        tool: "get_ui_settings",
        watchHttpConfigured,
        environment: {
          lambdaWatchHttpUrlPresent: watchHttpConfigured,
        },
        watch,
        capacityAlerts: watch.value.capacityAlerts,
        snipePrefs: watch.value.snipePrefs,
        snipeEnabledGpuTypes,
      });
    },
  });
}
