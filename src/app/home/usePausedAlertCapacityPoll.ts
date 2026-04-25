"use client";

import { PAUSED_CAPACITY_ALERT_POLL_MS } from "@/app/home/constants";
import { useEffect } from "react";

/**
 * While fast GPU capacity polling is paused, still refresh instance types on a
 * slow interval when the user has capacity alerts, so alerting/snipe can observe
 * false→true capacity transitions.
 */
export function usePausedAlertCapacityPoll(
  fetchInstanceTypes: () => Promise<void>,
  capacityPollingPaused: boolean,
  capacityAlertsLength: number
) {
  useEffect(() => {
    if (!capacityPollingPaused || capacityAlertsLength === 0) return;
    const id = setInterval(
      () => void fetchInstanceTypes(),
      PAUSED_CAPACITY_ALERT_POLL_MS
    );
    return () => clearInterval(id);
  }, [
    fetchInstanceTypes,
    capacityPollingPaused,
    capacityAlertsLength,
  ]);
}
