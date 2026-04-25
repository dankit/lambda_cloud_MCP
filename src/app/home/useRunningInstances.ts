"use client";

import { INSTANCE_LIST_POLL_MS, LAMBDA_RATE_LIMIT_ALERT } from "@/app/home/constants";
import { formatError, parseInstancesListPayload } from "@/app/home/parsers";
import type { InstanceDetail } from "@/app/home/types";
import { useCallback, useEffect, useMemo, useState } from "react";

export function useRunningInstances(
  authHeaders: HeadersInit,
  applyLambdaHttpStatus: (res: Response) => void
) {
  const [runningInstances, setRunningInstances] = useState<InstanceDetail[]>(
    []
  );
  const [instancesListError, setInstancesListError] = useState<string | null>(
    null
  );
  const [terminatingId, setTerminatingId] = useState<string | null>(null);
  const [terminateError, setTerminateError] = useState<string | null>(null);
  const [postTerminateTrackIds, setPostTerminateTrackIds] = useState<string[]>(
    []
  );

  const fetchRunningInstances = useCallback(async () => {
    try {
      const res = await fetch("/api/lambda/instances", { headers: authHeaders });
      const body = (await res.json()) as unknown;
      applyLambdaHttpStatus(res);
      if (!res.ok) {
        if (res.status !== 429) {
          setInstancesListError(formatError(body));
        } else {
          setInstancesListError(null);
        }
        setRunningInstances([]);
        return;
      }
      setInstancesListError(null);
      setTerminateError(null);
      setRunningInstances(parseInstancesListPayload(body));
    } catch {
      setInstancesListError("Network error while fetching instances.");
      setRunningInstances([]);
    }
  }, [authHeaders, applyLambdaHttpStatus]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchRunningInstances();
    });
    const id = setInterval(
      () => void fetchRunningInstances(),
      INSTANCE_LIST_POLL_MS
    );
    return () => clearInterval(id);
  }, [fetchRunningInstances]);

  const clearTerminateError = useCallback(() => {
    setTerminateError(null);
  }, []);

  const runTerminate = useCallback(
    async (id: string) => {
      if (
        !globalThis.confirm(
          `Terminate instance ${id}? This shuts down the machine and cannot be undone.`
        )
      ) {
        return;
      }
      setTerminatingId(id);
      setTerminateError(null);
      try {
        const res = await fetch(
          `/api/lambda/instances/${encodeURIComponent(id)}/terminate`,
          { method: "POST", headers: { ...authHeaders } }
        );
        const body = (await res.json()) as unknown;
        applyLambdaHttpStatus(res);
        if (!res.ok) {
          if (res.status === 429) {
            setTerminateError(LAMBDA_RATE_LIMIT_ALERT);
          } else {
            setTerminateError(formatError(body));
          }
          return;
        }
        setPostTerminateTrackIds((prev) =>
          prev.includes(id) ? prev : [...prev, id]
        );
        void fetchRunningInstances();
      } catch {
        setTerminateError("Network error while terminating.");
      } finally {
        setTerminatingId(null);
      }
    },
    [authHeaders, applyLambdaHttpStatus, fetchRunningInstances]
  );

  const activePostTerminateTrackIds = useMemo(
    () =>
      postTerminateTrackIds.filter((id) =>
        runningInstances.some((i) => i.id === id)
      ),
    [postTerminateTrackIds, runningInstances]
  );

  return {
    runningInstances,
    instancesListError,
    terminatingId,
    terminateError,
    fetchRunningInstances,
    runTerminate,
    activePostTerminateTrackIds,
    clearTerminateError,
  };
}
