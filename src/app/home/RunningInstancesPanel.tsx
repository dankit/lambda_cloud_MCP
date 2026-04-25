"use client";

import {
  INSTANCE_LIST_POLL_MS,
  SSH_PORT,
} from "@/app/home/constants";
import { isInstanceTerminatingLike, publicIpDisplay } from "@/app/home/instance-status";
import type { InstanceDetail } from "@/app/home/types";
import { buildSshCommandLine } from "@/app/home/ssh-launcher";
import styles from "../page.module.css";

type Props = {
  instances: InstanceDetail[];
  instancesListError: string | null;
  terminateError: string | null;
  terminatingId: string | null;
  postTerminateTrackIds: string[];
  resolvedPemForSsh: string;
  onTerminate: (id: string) => void;
};

export function RunningInstancesPanel({
  instances,
  instancesListError,
  terminateError,
  terminatingId,
  postTerminateTrackIds,
  resolvedPemForSsh,
  onTerminate,
}: Props) {
  const pollSec = INSTANCE_LIST_POLL_MS / 1000;

  return (
    <section className={styles.instancePanel}>
      <h3>Running instances</h3>
      <p className={styles.instancePanelLead}>
        Fetched from <span className="mono">GET /instances</span> every{" "}
        <strong>{pollSec}</strong>s (separate from GPU capacity polling; keeps
        total API traffic lower). Reloading this page shows whatever is still
        running on your account.
      </p>
      {instancesListError && (
        <div className={styles.errorBanner}>{instancesListError}</div>
      )}
      {terminateError && (
        <div className={styles.errorBanner}>{terminateError}</div>
      )}
      {!instancesListError && instances.length === 0 && (
        <p className={styles.instancePanelEmpty}>
          No running instances returned by the API.
        </p>
      )}
      {instances.map((inst) => {
        const sshLine = inst.ip
          ? buildSshCommandLine(inst.ip, resolvedPemForSsh)
          : null;
        const terminateInFlight = terminatingId === inst.id;
        const terminateSent = postTerminateTrackIds.includes(inst.id);
        const statusTerminating = isInstanceTerminatingLike(inst.status);
        const terminateDisabled =
          terminateInFlight || statusTerminating || terminateSent;
        return (
          <article key={inst.id} className={styles.instanceCard}>
            <h4 className={styles.instanceCardTitle}>
              <span className="mono">{inst.id}</span>
              {inst.name ? ` — ${inst.name}` : ""}
            </h4>
            <dl className={styles.kv}>
              <dt>Status</dt>
              <dd>{inst.status ?? "—"}</dd>
              <dt>Public IP</dt>
              <dd className="mono">{publicIpDisplay(inst)}</dd>
              <dt>Private IP</dt>
              <dd className="mono">{inst.private_ip ?? "—"}</dd>
              <dt>Hostname</dt>
              <dd className="mono">{inst.hostname ?? "—"}</dd>
              <dt>SSH port</dt>
              <dd>{SSH_PORT} (default)</dd>
              <dt>Region</dt>
              <dd>{inst.region?.name ?? "—"}</dd>
              <dt>SSH keys</dt>
              <dd>{(inst.ssh_key_names ?? []).join(", ") || "—"}</dd>
              {inst.jupyter_url && (
                <>
                  <dt>Jupyter</dt>
                  <dd>
                    <a href={inst.jupyter_url} target="_blank" rel="noreferrer">
                      Open JupyterLab
                    </a>
                  </dd>
                </>
              )}
            </dl>
            <div className={styles.instanceActions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                disabled={terminateDisabled}
                title={
                  statusTerminating || terminateSent
                    ? "Terminate already requested or instance is shutting down."
                    : undefined
                }
                onClick={() => void onTerminate(inst.id)}
              >
                {terminateInFlight
                  ? "Terminating…"
                  : statusTerminating || terminateSent
                    ? "Shutting down"
                    : "Terminate instance"}
              </button>
            </div>
            {sshLine && (
              <div className={styles.sshBlock}>
                <strong>SSH</strong>
                <pre className="mono">{sshLine}</pre>
                <div className={styles.sshToolbar}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => void navigator.clipboard.writeText(sshLine)}
                  >
                    Copy command
                  </button>
                </div>
                <p className={styles.hint}>
                  In PowerShell, quoting differs from bash; confirm the{" "}
                  <code>-i</code> path is correct for your machine.
                </p>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
