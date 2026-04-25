"use client";

import { LAUNCH_COOLDOWN_MS } from "@/app/home/constants";
import { hasCapacity } from "@/app/home/parsers";
import type { CapacityAlert, GpuRow, SshKey } from "@/app/home/types";
import styles from "../page.module.css";

type Props = {
  displayRows: GpuRow[];
  gpuRowsLength: number;
  listError: string | null;
  capacityAlerts: CapacityAlert[];
  alertingTypes: Set<string>;
  sshKeys: SshKey[];
  launchCooldown: boolean;
  onOpenLaunch: (row: GpuRow) => void;
};

export function GpuCapacityTable({
  displayRows,
  gpuRowsLength,
  listError,
  capacityAlerts,
  alertingTypes,
  sshKeys,
  launchCooldown,
  onOpenLaunch,
}: Props) {
  const watched = new Set(
    capacityAlerts.map((a) => a.instance_type_name)
  );

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thNarrow} title="Types you added under Setup alerts">
              Watch
            </th>
            <th>Type</th>
            <th>GPU</th>
            <th>$/hr</th>
            <th>Specs</th>
            <th>Regions with capacity</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {gpuRowsLength === 0 && !listError && (
            <tr>
              <td colSpan={7}>
                <span className={styles.chipMuted}>
                  No GPU rows yet. Configure an API key or wait for data.
                </span>
              </td>
            </tr>
          )}
          {displayRows.map((row) => {
            const onWatchList = watched.has(row.instance_type_name);
            const alerting = alertingTypes.has(row.instance_type_name);
            const rowClass = [
              onWatchList ? styles.rowPinned : "",
              alerting ? styles.rowCapacityAlert : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <tr key={row.instance_type_name} className={rowClass || undefined}>
                <td className={styles.watchCell} aria-label={onWatchList ? "On watch list" : "Not watched"}>
                  <span className={styles.watchGlyph} title={onWatchList ? "Watched (Setup alerts)" : ""}>
                    {onWatchList ? "★" : "—"}
                  </span>
                </td>
                <td className="mono">{row.instance_type_name}</td>
                <td>{row.gpu_description || row.description}</td>
                <td>${row.priceUsdPerHour.toFixed(2)}</td>
                <td>
                  {row.gpus}× GPU, {row.vcpus} vCPU, {row.memory_gib} GiB RAM
                </td>
                <td>
                  <div className={styles.chips}>
                    {!hasCapacity(row) ? (
                      <span className={styles.chipMuted}>None right now</span>
                    ) : (
                      row.regions_with_capacity_available.map((r) => (
                        <span key={r.name} className={styles.chip} title={r.description}>
                          {r.name}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={
                      !hasCapacity(row) ||
                      !sshKeys.length ||
                      launchCooldown
                    }
                    title={
                      launchCooldown
                        ? `Launch rate limit (${LAUNCH_COOLDOWN_MS / 1000}s between launches)`
                        : undefined
                    }
                    onClick={() => onOpenLaunch(row)}
                  >
                    Launch
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
