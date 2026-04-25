"use client";

import { ALERTS_PANEL_ID } from "@/app/home/constants";
import {
  buildWatchRegionSelectGroups,
  hasCapacity,
  hasCapacityInWatchScope,
  watchRegionSelectValueSet,
} from "@/app/home/parsers";
import type { CapacityAlert, GpuRow, Region, SnipePref, SshKey } from "@/app/home/types";
import styles from "../page.module.css";
import { useMemo } from "react";

type Props = {
  instanceTypesLoadedOnce: boolean;
  alertsSetupOpen: boolean;
  onToggleAlerts: () => void;
  alertsSetupSummary: string;
  gpuRowsSortedForSetup: GpuRow[];
  capacityAlerts: CapacityAlert[];
  regionsList: Region[];
  snipePrefs: Record<string, SnipePref>;
  snipeError: string | null;
  sshKeys: SshKey[];
  testPreviewActive: boolean;
  onSetCapacityAlertForType: (name: string, enabled: boolean) => void;
  onAlertRegionChange: (instanceTypeName: string, regionName: string) => void;
  onSnipePrefChange: (instanceTypeName: string, next: SnipePref) => void;
  onRunTestAlert: () => void;
};

export function AlertsSetupSection({
  instanceTypesLoadedOnce,
  alertsSetupOpen,
  onToggleAlerts,
  alertsSetupSummary,
  gpuRowsSortedForSetup,
  capacityAlerts,
  regionsList,
  snipePrefs,
  snipeError,
  sshKeys,
  testPreviewActive,
  onSetCapacityAlertForType,
  onAlertRegionChange,
  onSnipePrefChange,
  onRunTestAlert,
}: Props) {
  const watchRegionGroups = useMemo(
    () => buildWatchRegionSelectGroups(regionsList),
    [regionsList]
  );
  const watchRegionKnownValues = useMemo(
    () => watchRegionSelectValueSet(watchRegionGroups),
    [watchRegionGroups]
  );

  if (!instanceTypesLoadedOnce) return null;

  const byName = new Map(
    gpuRowsSortedForSetup.map((r) => [r.instance_type_name, r] as const)
  );

  return (
    <>
      <div className={styles.settingsBar}>
        <button
          type="button"
          className={styles.settingsToggle}
          aria-expanded={alertsSetupOpen}
          aria-controls={ALERTS_PANEL_ID}
          onClick={onToggleAlerts}
        >
          <span className={styles.settingsToggleLabel}>Setup alerts</span>
          <span className={styles.settingsSummary} aria-hidden>
            {alertsSetupSummary}
          </span>
          <span className={styles.chevron} data-open={alertsSetupOpen}>
            ▼
          </span>
        </button>
      </div>

      <div
        id={ALERTS_PANEL_ID}
        className={styles.settingsPanel}
        hidden={!alertsSetupOpen}
      >
        <div className={styles.alertsSetupBody}>
          <p className={styles.alertsSetupLead}>
            Choose GPU types to watch, then set <strong>watch region</strong> per
            alert (default <strong>Any region</strong> = capacity anywhere; pick a
            named region to scope alerts and Snipe to that location; where zones
            share a name like <span className="mono">us-east-1</span>, you can pick
            the whole area (<span className="mono">All us-east (any zone)</span>) or
            one zone. Watched types
            stay at the top of the table; a flashing row and repeating beep fire
            when capacity appears in that scope (highlight is immediate; sound
            needs a prior click anywhere on the page, unlike{" "}
            <strong>Test alert</strong> which unlocks audio on its button).{" "}
            <strong>Snipe</strong> launches in
            the watch region, or the first region with capacity when set to Any
            region (only while you have no running instances; respects the same
            launch rate limit as manual launch).{" "}
            <strong>
              There is no hard check that this GPU is actually available in every
              region shown—double-check your region on the{" "}
              <a
                href="https://www.lambda.ai/"
                target="_blank"
                rel="noopener noreferrer"
              >
                official Lambda site
              </a>{" "}
              to ensure the GPU is supported there.
            </strong>
          </p>

          {snipeError && (
            <div className={styles.errorBanner} role="alert">
              Snipe: {snipeError}
            </div>
          )}

          <h4 className={styles.alertBrowseHeading}>Your alerts</h4>
          {capacityAlerts.length === 0 ? (
            <p className={styles.alertBrowseEmpty}>
              None yet — enable types in the list below.
            </p>
          ) : (
            <ul className={styles.alertBrowseList} aria-label="Active capacity alerts">
              {capacityAlerts.map(({ instance_type_name: name, region_name }) => {
                const row = byName.get(name);
                const pref =
                  snipePrefs[name] ?? {
                    enabled: false,
                    ssh_key_name: "",
                  };
                const region = region_name.trim();
                const capacityNow = row
                  ? region === ""
                    ? hasCapacity(row)
                    : hasCapacityInWatchScope(row, region)
                  : false;
                const needsLegacyRegionOption =
                  region !== "" && !watchRegionKnownValues.has(region);
                return (
                  <li key={name} className={styles.alertBrowseCard}>
                    <div className={styles.alertBrowseCardHeader}>
                      <span className={`mono ${styles.alertBrowseName}`}>{name}</span>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost}`}
                        onClick={() => onSetCapacityAlertForType(name, false)}
                      >
                        Remove alert
                      </button>
                    </div>
                    <p className={styles.alertBrowseMeta}>
                      {row?.gpu_description || row?.description || "—"} · capacity:{" "}
                      <strong>{capacityNow ? "yes" : "no"}</strong>
                      {region ? ` (${region})` : " (any region)"}
                    </p>
                    <div className={`${styles.field} ${styles.alertBrowseCardField}`}>
                      <label htmlFor={`alert-region-${name}`}>Watch region</label>
                      <select
                        id={`alert-region-${name}`}
                        value={region_name}
                        onChange={(e) =>
                          onAlertRegionChange(name, e.target.value)
                        }
                      >
                        <option value="">Any region</option>
                        {needsLegacyRegionOption && (
                          <option value={region}>
                            {region} (saved — not in current region list)
                          </option>
                        )}
                        {watchRegionGroups.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.options.map((o) => (
                              <option key={`${g.label}-${o.value}`} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <label className={styles.snipeRow}>
                      <input
                        type="checkbox"
                        checked={pref.enabled}
                        onChange={(e) =>
                          onSnipePrefChange(name, {
                            ...pref,
                            enabled: e.target.checked,
                          })
                        }
                      />
                      <span>Snipe (auto-launch on capacity)</span>
                    </label>
                    {pref.enabled && (
                      <div className={styles.snipeFields}>
                        <div className={styles.field}>
                          <label htmlFor={`snipe-key-${name}`}>SSH key</label>
                          <select
                            id={`snipe-key-${name}`}
                            value={pref.ssh_key_name}
                            onChange={(e) =>
                              onSnipePrefChange(name, {
                                ...pref,
                                ssh_key_name: e.target.value,
                              })
                            }
                          >
                            <option value="">Default (first key in account)</option>
                            {sshKeys.map((k) => (
                              <option key={k.id} value={k.name}>
                                {k.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div
            className={`${styles.testAlertPreview} ${testPreviewActive ? styles.rowCapacityAlert : ""}`}
            aria-live="polite"
          >
            {testPreviewActive
              ? "Test alert preview (visual + sound)"
              : "Test alert preview area"}
          </div>
          <div className={styles.rowActions} style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onRunTestAlert}
            >
              Test alert
            </button>
          </div>
          <p className={styles.alertCatalogLead}>Add or remove watched types</p>
          <ul className={styles.alertTypeList} aria-label="GPU types for capacity alerts">
            {gpuRowsSortedForSetup.map((row) => {
              const checked = capacityAlerts.some(
                (a) => a.instance_type_name === row.instance_type_name
              );
              const id = `alert-${row.instance_type_name}`;
              return (
                <li key={row.instance_type_name}>
                  <label className={styles.alertTypeRow} htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        onSetCapacityAlertForType(
                          row.instance_type_name,
                          e.target.checked
                        )
                      }
                    />
                    <span className={`mono ${styles.alertTypeName}`}>
                      {row.instance_type_name}
                    </span>
                    <span className={styles.alertTypeMeta}>
                      {row.gpu_description || row.description}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
