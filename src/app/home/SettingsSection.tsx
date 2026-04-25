"use client";

import { MIN_POLL_SECONDS, SETTINGS_PANEL_ID } from "@/app/home/constants";
import styles from "../page.module.css";

type Props = {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  settingsSummary: string;
  apiKeyOverride: string;
  onApiKeyChange: (v: string) => void;
  pemOverride: string;
  onPemChange: (v: string) => void;
  intervalInput: string;
  onIntervalInputChange: (v: string) => void;
  onApplyInterval: () => void;
  loadingTypes: boolean;
  onRefreshNow: () => void;
};

export function SettingsSection({
  settingsOpen,
  onToggleSettings,
  settingsSummary,
  apiKeyOverride,
  onApiKeyChange,
  pemOverride,
  onPemChange,
  intervalInput,
  onIntervalInputChange,
  onApplyInterval,
  loadingTypes,
  onRefreshNow,
}: Props) {
  return (
    <>
      <div className={styles.settingsBar}>
        <button
          type="button"
          className={styles.settingsToggle}
          aria-expanded={settingsOpen}
          aria-controls={SETTINGS_PANEL_ID}
          onClick={onToggleSettings}
        >
          <span className={styles.settingsToggleLabel}>Settings</span>
          <span className={styles.settingsSummary} aria-hidden>
            {settingsSummary}
          </span>
          <span className={styles.chevron} data-open={settingsOpen}>
            ▼
          </span>
        </button>
      </div>

      <div
        id={SETTINGS_PANEL_ID}
        className={styles.settingsPanel}
        hidden={!settingsOpen}
      >
        <section className={styles.toolbar}>
          <div className={styles.field}>
            <label htmlFor="apiKey">API key (optional if set in .env)</label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={apiKeyOverride}
              onChange={(e) => onApiKeyChange(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="pemPath">PEM path (optional if set in .env)</label>
            <input
              id="pemPath"
              type="text"
              autoComplete="off"
              placeholder="path/to/your-key.pem"
              value={pemOverride}
              onChange={(e) => onPemChange(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="interval">Poll interval (seconds)</label>
            <input
              id="interval"
              type="number"
              min={MIN_POLL_SECONDS}
              step={1}
              value={intervalInput}
              onChange={(e) => onIntervalInputChange(e.target.value)}
            />
          </div>
          <div className={styles.rowActions}>
            <button type="button" className={styles.btn} onClick={onApplyInterval}>
              Apply interval
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void onRefreshNow()}
              disabled={loadingTypes}
            >
              Refresh now
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
