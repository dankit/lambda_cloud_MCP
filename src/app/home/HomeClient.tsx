"use client";

import { AlertsSetupSection } from "@/app/home/AlertsSetupSection";
import { McpSetupSection } from "@/app/home/McpSetupSection";
import { LAMBDA_RATE_LIMIT_ALERT, MIN_POLL_SECONDS } from "@/app/home/constants";
import { GpuCapacityTable } from "@/app/home/GpuCapacityTable";
import { LaunchModal } from "@/app/home/LaunchModal";
import { RunningInstancesPanel } from "@/app/home/RunningInstancesPanel";
import { SettingsSection } from "@/app/home/SettingsSection";
import { useAlertAudio } from "@/app/home/useAlertAudio";
import { useCapacityAlerts } from "@/app/home/useCapacityAlerts";
import { useLambdaConfigAndAuth } from "@/app/home/useLambdaConfigAndAuth";
import { useLambdaDataPolling } from "@/app/home/useLambdaDataPolling";
import { useLaunchModal } from "@/app/home/useLaunchModal";
import { usePausedAlertCapacityPoll } from "@/app/home/usePausedAlertCapacityPoll";
import { useRunningInstances } from "@/app/home/useRunningInstances";
import { useMemo, useState } from "react";
import styles from "../page.module.css";

export function HomeClient() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mcpSetupOpen, setMcpSetupOpen] = useState(false);
  const [alertsSetupOpen, setAlertsSetupOpen] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);

  const config = useLambdaConfigAndAuth();
  const running = useRunningInstances(
    config.authHeaders,
    config.applyLambdaHttpStatus
  );

  const capacityPollingPaused =
    running.runningInstances.length > 0 || launchBusy;

  const data = useLambdaDataPolling(
    config.authHeaders,
    config.applyLambdaHttpStatus,
    config.intervalSec,
    capacityPollingPaused
  );

  const launch = useLaunchModal({
    authHeaders: config.authHeaders,
    applyLambdaHttpStatus: config.applyLambdaHttpStatus,
    fetchRunningInstances: running.fetchRunningInstances,
    sshKeys: data.sshKeys,
    onLaunchSuccess: running.clearTerminateError,
    setLaunchBusy,
    runningInstancesLength: running.runningInstances.length,
  });

  const alerts = useCapacityAlerts({
    gpuRows: data.gpuRows,
    sshKeys: data.sshKeys,
    launchInstance: launch.launchInstance,
    runningInstancesLength: running.runningInstances.length,
    launchBusy,
    launchCooldown: launch.launchCooldown,
    watchConfigSyncConfigured: config.watchConfigSyncConfigured,
    watchConfigSyncSecret:
      process.env.NEXT_PUBLIC_LAMBDA_WATCH_SYNC_SECRET ?? null,
  });

  const audio = useAlertAudio(alerts.alertingTypes, alerts.alertingKey);

  usePausedAlertCapacityPoll(
    data.fetchInstanceTypes,
    capacityPollingPaused,
    alerts.capacityAlerts.length
  );

  const settingsSummary = useMemo(() => {
    const bits: string[] = [];
    bits.push(config.apiKeyBadge.ok ? "API ok" : "API missing");
    bits.push(config.pemBadge.ok ? "PEM ok" : "PEM unset");
    return bits.join(" · ");
  }, [config.apiKeyBadge.ok, config.pemBadge.ok]);

  const resolvedPemForSsh = useMemo(() => {
    const t = config.resolvedPemPath?.trim();
    if (t) return t;
    return "<set LAMBDA_SSH_PEM_PATH in .env or PEM path in UI>";
  }, [config.resolvedPemPath]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Lambda Cloud GPU availability</h1>
        <p className={styles.subtitle}>
          Polls{" "}
          <a
            href="https://cloud.lambda.ai/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Lambda Cloud
          </a>{" "}
          for capacity. Launch uses the official HTTP API (see{" "}
          <a
            href="https://docs-api.lambda.ai/api/cloud"
            target="_blank"
            rel="noopener noreferrer"
          >
            API docs
          </a>
          ). Global limit ~1 req/s; launch ~1 per 12s.
        </p>
      </header>

      <SettingsSection
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
        settingsSummary={settingsSummary}
        apiKeyOverride={config.apiKeyOverride}
        onApiKeyChange={config.setApiKeyOverride}
        pemOverride={config.pemOverride}
        onPemChange={config.setPemOverride}
        intervalInput={config.intervalInput}
        onIntervalInputChange={config.setIntervalInput}
        onApplyInterval={config.applyInterval}
        loadingTypes={data.loadingTypes}
        onRefreshNow={data.fetchInstanceTypes}
      />

      <McpSetupSection
        open={mcpSetupOpen}
        onToggle={() => setMcpSetupOpen((o) => !o)}
      />

      <div className={styles.badges} style={{ marginBottom: "1rem" }}>
        <span
          className={`${styles.badge} ${config.apiKeyBadge.ok ? styles.badgeOk : styles.badgeWarn}`}
        >
          {config.apiKeyBadge.label}
        </span>
        <span
          className={`${styles.badge} ${config.pemBadge.ok ? styles.badgeOk : styles.badgeWarn}`}
        >
          {config.pemBadge.label}
        </span>
        {config.resolvedPemSource !== "none" && (
          <span className={`${styles.badge} ${styles.badgeOk}`}>
            Resolved PEM for SSH:{" "}
            {config.resolvedPemSource === "env" ? ".env" : "UI"}
          </span>
        )}
      </div>

      {alerts.watchConfigMergeConflict && (
        <div className={styles.watchConflictBanner} role="alert">
          <strong>Watch / Snipe differs from synced file.</strong> This browser
          has alerts or snipe prefs that disagree with{" "}
          <code>/api/watch-config</code> (what MCP reads). Choose which side
          should win.
          <div className={styles.watchConflictActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={alerts.resolveWatchConflictUseServer}
            >
              Use server (match MCP)
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={alerts.resolveWatchConflictKeepLocal}
            >
              Keep this browser and overwrite file
            </button>
          </div>
        </div>
      )}

      <div className={styles.statusLine}>
        <span>
          {capacityPollingPaused ? (
            <>
              GPU capacity polling{" "}
              <strong>paused</strong> (running instance or launch in progress)
            </>
          ) : (
            <>
              Polling every{" "}
              <strong>{Math.max(MIN_POLL_SECONDS, config.intervalSec)}</strong>s
              (min {MIN_POLL_SECONDS}s)
            </>
          )}
        </span>
        {data.lastUpdated && (
          <span>Last updated: {data.lastUpdated.toLocaleTimeString()}</span>
        )}
        {data.loadingTypes && <span>Loading…</span>}
      </div>

      {capacityPollingPaused && (
        <p className={styles.pauseBanner} role="status">
          Fast capacity polling for the GPU table is paused to reduce API traffic
          while you operate a machine. It resumes automatically when no instance
          is running and no launch is in progress.
          {alerts.capacityAlerts.length > 0 ? (
            <>
              {" "}
              <strong>Note:</strong> while paused, instance types still refresh on
              a slower interval so capacity alerts and Snipe can detect new stock.
            </>
          ) : null}
        </p>
      )}

      <AlertsSetupSection
        instanceTypesLoadedOnce={data.instanceTypesLoadedOnce}
        alertsSetupOpen={alertsSetupOpen}
        onToggleAlerts={() => setAlertsSetupOpen((o) => !o)}
        alertsSetupSummary={alerts.alertsSetupSummary}
        gpuRowsSortedForSetup={alerts.gpuRowsSortedForSetup}
        capacityAlerts={alerts.capacityAlerts}
        regionsList={data.regionsList}
        snipePrefs={alerts.snipePrefs}
        snipeError={alerts.snipeError}
        sshKeys={data.sshKeys}
        testPreviewActive={audio.testPreviewActive}
        onSetCapacityAlertForType={alerts.setCapacityAlertForType}
        onAlertRegionChange={alerts.setCapacityAlertRegion}
        onSnipePrefChange={alerts.onSnipePrefChange}
        onRunTestAlert={audio.runTestAlert}
      />

      {alerts.alertingTypes.size > 0 && !audio.audioUnlocked && (
        <p className={styles.soundHint}>
          Capacity alert active — the table row is highlighted now. Browsers only
          allow sound after a gesture: click anywhere here (or use{" "}
          <strong>Test alert</strong> in Setup alerts) to unlock repeating beeps.
        </p>
      )}
      {alerts.alertingTypes.size > 0 && audio.audioUnlocked && (
        <p className={styles.soundHintMuted}>
          Sound on for capacity alerts. Test alert uses the same path but unlocks
          audio in the same click as the button.
        </p>
      )}

      {config.lambdaRateLimitHit && (
        <div className={styles.errorBanner} role="alert">
          {LAMBDA_RATE_LIMIT_ALERT}
        </div>
      )}

      {data.listError && (
        <div className={styles.errorBanner}>{data.listError}</div>
      )}
      {data.keysError && (
        <div className={styles.errorBanner}>SSH keys: {data.keysError}</div>
      )}
      {data.regionsError && (
        <div className={styles.errorBanner}>Regions: {data.regionsError}</div>
      )}

      <GpuCapacityTable
        displayRows={alerts.displayRows}
        gpuRowsLength={data.gpuRows.length}
        listError={data.listError}
        capacityAlerts={alerts.capacityAlerts}
        alertingTypes={alerts.alertingTypes}
        sshKeys={data.sshKeys}
        launchCooldown={launch.launchCooldown}
        runningInstancesLength={running.runningInstances.length}
        onOpenLaunch={launch.openLaunch}
      />

      {launch.launchModal && (
        <LaunchModal
          launchModal={launch.launchModal}
          launchRegion={launch.launchRegion}
          launchKeyName={launch.launchKeyName}
          launchError={launch.launchError}
          launchBusy={launchBusy}
          launchCooldown={launch.launchCooldown}
          runningInstancesLength={running.runningInstances.length}
          sshKeys={data.sshKeys}
          onClose={launch.closeLaunch}
          onLaunch={launch.runLaunch}
          onChangeRegion={launch.setLaunchRegion}
          onChangeKeyName={launch.setLaunchKeyName}
        />
      )}

      <RunningInstancesPanel
        instances={running.runningInstances}
        instancesListError={running.instancesListError}
        terminateError={running.terminateError}
        terminatingId={running.terminatingId}
        postTerminateTrackIds={running.activePostTerminateTrackIds}
        resolvedPemForSsh={resolvedPemForSsh}
        onTerminate={running.runTerminate}
      />
    </div>
  );
}
