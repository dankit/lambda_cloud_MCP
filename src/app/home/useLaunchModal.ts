"use client";

import { LAUNCH_COOLDOWN_MS, LAMBDA_RATE_LIMIT_ALERT } from "@/app/home/constants";
import { formatError } from "@/app/home/parsers";
import type { GpuRow, SshKey } from "@/app/home/types";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Single-instance cap is enforced inside `launchInstance` so manual launches and
 * snipe go through the same gate; the UI also disables buttons for clarity.
 */
export const SINGLE_INSTANCE_LIMIT_MESSAGE =
  "Refused: max 1 Lambda instance at a time. Terminate the running one first.";

export function useLaunchModal({
  authHeaders,
  applyLambdaHttpStatus,
  fetchRunningInstances,
  sshKeys,
  onLaunchSuccess,
  setLaunchBusy,
  runningInstancesLength,
}: {
  authHeaders: HeadersInit;
  applyLambdaHttpStatus: (res: Response) => void;
  fetchRunningInstances: () => Promise<void>;
  sshKeys: SshKey[];
  onLaunchSuccess: () => void;
  setLaunchBusy: (busy: boolean) => void;
  runningInstancesLength: number;
}) {
  const [launchModal, setLaunchModal] = useState<GpuRow | null>(null);
  const [launchRegion, setLaunchRegion] = useState("");
  const [launchKeyName, setLaunchKeyName] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchCooldown, setLaunchCooldown] = useState(false);
  const launchCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const armLaunchCooldown = useCallback(() => {
    if (launchCooldownTimerRef.current) {
      clearTimeout(launchCooldownTimerRef.current);
    }
    setLaunchCooldown(true);
    launchCooldownTimerRef.current = setTimeout(() => {
      setLaunchCooldown(false);
      launchCooldownTimerRef.current = null;
    }, LAUNCH_COOLDOWN_MS);
  }, []);

  const launchInstance = useCallback(
    async (
      instanceTypeName: string,
      regionName: string,
      sshKeyName: string
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      const region = regionName.trim();
      const key = sshKeyName.trim();
      if (!region || !key) {
        return { ok: false, message: "Pick a region and SSH key." };
      }
      if (runningInstancesLength > 0) {
        return { ok: false, message: SINGLE_INSTANCE_LIMIT_MESSAGE };
      }
      setLaunchBusy(true);
      try {
        const res = await fetch("/api/lambda/launch", {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            region_name: region,
            instance_type_name: instanceTypeName,
            ssh_key_name: key,
          }),
        });
        const body = (await res.json()) as unknown;
        applyLambdaHttpStatus(res);
        armLaunchCooldown();
        if (!res.ok) {
          if (res.status === 429) {
            return { ok: false, message: LAMBDA_RATE_LIMIT_ALERT };
          }
          return { ok: false, message: formatError(body) };
        }
        const ids = (body as { data?: { instance_ids?: string[] } })?.data
          ?.instance_ids;
        const id = ids?.[0];
        if (!id) {
          return {
            ok: false,
            message: "Launch succeeded but no instance id was returned.",
          };
        }
        onLaunchSuccess();
        await fetchRunningInstances();
        return { ok: true };
      } catch {
        armLaunchCooldown();
        return { ok: false, message: "Network error during launch." };
      } finally {
        setLaunchBusy(false);
      }
    },
    [
      authHeaders,
      armLaunchCooldown,
      applyLambdaHttpStatus,
      fetchRunningInstances,
      onLaunchSuccess,
      setLaunchBusy,
      runningInstancesLength,
    ]
  );

  useEffect(() => {
    return () => {
      if (launchCooldownTimerRef.current) {
        clearTimeout(launchCooldownTimerRef.current);
      }
    };
  }, []);

  const openLaunch = useCallback(
    (row: GpuRow) => {
      setLaunchError(null);
      setLaunchModal(row);
      const first = row.regions_with_capacity_available[0]?.name ?? "";
      setLaunchRegion(first);
      setLaunchKeyName(sshKeys[0]?.name ?? "");
    },
    [sshKeys]
  );

  useEffect(() => {
    if (!launchModal || !sshKeys.length) return;
    if (sshKeys.some((k) => k.name === launchKeyName)) return;
    queueMicrotask(() => setLaunchKeyName(sshKeys[0].name));
  }, [launchModal, sshKeys, launchKeyName]);

  const closeLaunch = useCallback(() => {
    setLaunchModal(null);
    setLaunchBusy(false);
    setLaunchError(null);
  }, [setLaunchBusy]);

  const runLaunch = useCallback(async () => {
    if (!launchModal) return;
    setLaunchError(null);
    const r = await launchInstance(
      launchModal.instance_type_name,
      launchRegion,
      launchKeyName
    );
    if (!r.ok) {
      setLaunchError(r.message);
      return;
    }
    closeLaunch();
  }, [
    launchInstance,
    launchModal,
    launchRegion,
    launchKeyName,
    closeLaunch,
  ]);

  return {
    launchModal,
    launchRegion,
    launchKeyName,
    launchCooldown,
    launchError,
    setLaunchRegion,
    setLaunchKeyName,
    openLaunch,
    closeLaunch,
    runLaunch,
    launchInstance,
  };
}
