"use client";

import { MCP_SETUP_PANEL_ID } from "@/app/home/constants";
import type { McpSetupHintsPayload } from "@/lib/mcp-setup-hints";
import { useCallback, useEffect, useState } from "react";
import styles from "../page.module.css";

type Props = {
  open: boolean;
  onToggle: () => void;
};

export function McpSetupSection({ open, onToggle }: Props) {
  const [hints, setHints] = useState<McpSetupHintsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/mcp-setup-hints")
      .then((r) => {
        if (!r.ok)
          throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<McpSetupHintsPayload>;
      })
      .then((data) => {
        if (cancelled) return;
        setLoadError(null);
        setHints(data);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Could not load setup hints.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const snippet = hints?.mcpDotenvSnippet ?? "";

  const copySnippet = useCallback(() => {
    if (!snippet) return;
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [snippet]);

  const summaryParts: string[] = [];
  if (hints?.watchConfigGetLikelyWorks) summaryParts.push("watch GET ok");
  else summaryParts.push("watch GET check");
  if (hints?.apiKeyConfigured) summaryParts.push("API in .env");
  else summaryParts.push(".env API ?");

  return (
    <>
      <div className={styles.settingsBar}>
        <button
          type="button"
          className={styles.settingsToggle}
          aria-expanded={open}
          aria-controls={MCP_SETUP_PANEL_ID}
          onClick={onToggle}
        >
          <span className={styles.settingsToggleLabel}>MCP setup</span>
          <span className={styles.settingsSummary} aria-hidden>
            {hints ? summaryParts.join(" · ") : "Open for URL + snippet"}
          </span>
          <span className={styles.chevron} data-open={open}>
            ▼
          </span>
        </button>
      </div>

      <div
        id={MCP_SETUP_PANEL_ID}
        className={styles.settingsPanel}
        hidden={!open}
      >
        <section className={styles.toolbar} style={{ flexDirection: "column" }}>
          {loadError && (
            <p className={styles.mcpSetupError} role="alert">
              {loadError}
            </p>
          )}
          {!hints && !loadError && (
            <p className={styles.mcpSetupLead}>Loading hints…</p>
          )}
          {hints && (
            <>
              <p className={styles.mcpSetupLead}>{hints.uiOverridesNote}</p>

              <div className={styles.badges}>
                <span
                  className={`${styles.badge} ${hints.apiKeyConfigured ? styles.badgeOk : styles.badgeWarn}`}
                >
                  Lambda API key (.env){hints.apiKeyConfigured ? "" : " missing"}
                </span>
                <span
                  className={`${styles.badge} ${hints.pemPathConfigured ? styles.badgeOk : styles.badgeWarn}`}
                >
                  PEM path (.env)
                  {!hints.pemPathConfigured
                    ? " missing"
                    : hints.pemPathFilename
                      ? ` (${hints.pemPathFilename})`
                      : ""}
                </span>
                <span
                  className={`${styles.badge} ${hints.watchConfigGetLikelyWorks ? styles.badgeOk : styles.badgeWarn}`}
                >
                  {hints.watchConfigGetLikelyWorks
                    ? "/api/watch-config readable"
                    : "watch-config path blocked"}
                </span>
                <span className={`${styles.badge} ${styles.chipMuted}`}>
                  Sync secret header:{" "}
                  {hints.syncSecretRequired ? "required" : "optional"}
                </span>
              </div>

              <div className={styles.field} style={{ minWidth: "100%" }}>
                <label htmlFor="mcpWatchUrl">
                  Derived LAMBDA_WATCH_HTTP_URL (this browser origin)
                </label>
                <input
                  id="mcpWatchUrl"
                  type="text"
                  readOnly
                  value={hints.suggestedWatchHttpUrl}
                />
              </div>

              <div className={styles.field} style={{ minWidth: "100%" }}>
                <div className={styles.rowActions} style={{ marginBottom: 4 }}>
                  <label htmlFor="mcpSnippet" style={{ flex: 1, margin: 0 }}>
                    Copy-paste MCP env block
                  </label>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={!snippet}
                    onClick={copySnippet}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <textarea
                  id="mcpSnippet"
                  readOnly
                  rows={22}
                  className={styles.mcpSnippet}
                  value={snippet}
                  spellCheck={false}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
