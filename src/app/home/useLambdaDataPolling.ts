"use client";

import {
  MIN_POLL_SECONDS,
} from "@/app/home/constants";
import { formatError, parseGpuRows, parseRegions, parseSshKeys } from "@/app/home/parsers";
import type { GpuRow, Region, SshKey } from "@/app/home/types";
import { useCallback, useEffect, useRef, useState } from "react";

export function useLambdaDataPolling(
  authHeaders: HeadersInit,
  applyLambdaHttpStatus: (res: Response) => void,
  intervalSec: number,
  capacityPollingPaused: boolean
) {
  const [gpuRows, setGpuRows] = useState<GpuRow[]>([]);
  const [regionsList, setRegionsList] = useState<Region[]>([]);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [sshKeys, setSshKeys] = useState<SshKey[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [instanceTypesLoadedOnce, setInstanceTypesLoadedOnce] =
    useState(false);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const capacityPollingWasPausedRef = useRef(false);

  const fetchInstanceTypes = useCallback(async () => {
    setLoadingTypes(true);
    setListError(null);
    try {
      const res = await fetch("/api/lambda/instance-types", {
        headers: authHeaders,
      });
      const body: unknown = await res.json();
      applyLambdaHttpStatus(res);
      if (!res.ok) {
        if (res.status !== 429) {
          setListError(formatError(body));
        } else {
          setListError(null);
        }
        setGpuRows([]);
        return;
      }
      setInstanceTypesLoadedOnce(true);
      setGpuRows(parseGpuRows(body));
      setLastUpdated(new Date());
    } catch {
      setListError("Network error while fetching instance types.");
      setGpuRows([]);
    } finally {
      setLoadingTypes(false);
    }
  }, [authHeaders, applyLambdaHttpStatus]);

  const fetchSshKeys = useCallback(async () => {
    setKeysError(null);
    try {
      const res = await fetch("/api/lambda/ssh-keys", { headers: authHeaders });
      const body: unknown = await res.json();
      applyLambdaHttpStatus(res);
      if (!res.ok) {
        if (res.status !== 429) {
          setKeysError(formatError(body));
        } else {
          setKeysError(null);
        }
        setSshKeys([]);
        return;
      }
      setSshKeys(parseSshKeys(body));
    } catch {
      setKeysError("Network error while fetching SSH keys.");
      setSshKeys([]);
    }
  }, [authHeaders, applyLambdaHttpStatus]);

  const fetchRegions = useCallback(async () => {
    setRegionsError(null);
    try {
      const res = await fetch("/api/lambda/regions", { headers: authHeaders });
      const body: unknown = await res.json();
      applyLambdaHttpStatus(res);
      if (!res.ok) {
        if (res.status !== 429) {
          setRegionsError(formatError(body));
        } else {
          setRegionsError(null);
        }
        setRegionsList([]);
        return;
      }
      setRegionsList(parseRegions(body));
    } catch {
      setRegionsError("Network error while fetching regions.");
      setRegionsList([]);
    }
  }, [authHeaders, applyLambdaHttpStatus]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchInstanceTypes();
      void fetchSshKeys();
      void fetchRegions();
    });
  }, [fetchInstanceTypes, fetchSshKeys, fetchRegions]);

  useEffect(() => {
    if (capacityPollingPaused) return;
    const ms = Math.max(MIN_POLL_SECONDS, intervalSec) * 1000;
    const id = setInterval(() => {
      void fetchInstanceTypes();
    }, ms);
    return () => clearInterval(id);
  }, [intervalSec, fetchInstanceTypes, capacityPollingPaused]);

  useEffect(() => {
    if (capacityPollingWasPausedRef.current && !capacityPollingPaused) {
      void fetchInstanceTypes();
    }
    capacityPollingWasPausedRef.current = capacityPollingPaused;
  }, [capacityPollingPaused, fetchInstanceTypes]);

  return {
    gpuRows,
    regionsList,
    regionsError,
    sshKeys,
    listError,
    keysError,
    instanceTypesLoadedOnce,
    loadingTypes,
    lastUpdated,
    fetchInstanceTypes,
    fetchSshKeys,
    fetchRegions,
  };
}
