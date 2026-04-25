"use client";

import type { GpuRow, SshKey } from "@/app/home/types";
import styles from "../page.module.css";

type Props = {
  launchModal: GpuRow;
  launchRegion: string;
  launchKeyName: string;
  launchError: string | null;
  launchBusy: boolean;
  launchCooldown: boolean;
  sshKeys: SshKey[];
  onClose: () => void;
  onLaunch: () => void;
  onChangeRegion: (region: string) => void;
  onChangeKeyName: (name: string) => void;
};

export function LaunchModal({
  launchModal,
  launchRegion,
  launchKeyName,
  launchError,
  launchBusy,
  launchCooldown,
  sshKeys,
  onClose,
  onLaunch,
  onChangeRegion,
  onChangeKeyName,
}: Props) {
  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal
        aria-labelledby="launch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="launch-title">Launch instance</h2>
        <p className={styles.modalLead}>
          {launchModal.instance_type_name} —{" "}
          {launchModal.gpu_description || launchModal.description}
        </p>
        <div className={styles.field} style={{ marginTop: "1rem" }}>
          <label htmlFor="region">Region (must have capacity)</label>
          <select
            id="region"
            value={launchRegion}
            onChange={(e) => onChangeRegion(e.target.value)}
          >
            {launchModal.regions_with_capacity_available.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
                {r.description ? ` — ${r.description}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field} style={{ marginTop: "0.75rem" }}>
          <label htmlFor="sshKey">SSH key name (registered in Lambda)</label>
          <select
            id="sshKey"
            value={launchKeyName}
            onChange={(e) => onChangeKeyName(e.target.value)}
          >
            {sshKeys.map((k) => (
              <option key={k.id} value={k.name}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
        {launchError && <p className={styles.modalError}>{launchError}</p>}
        <div className={styles.modalActions}>
          <button type="button" className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={launchBusy || launchCooldown}
            onClick={() => void onLaunch()}
          >
            {launchBusy ? "Launching…" : "Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}
