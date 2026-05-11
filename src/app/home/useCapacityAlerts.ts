"use client";

import {
  ALERT_STORAGE_KEY,
  SNIPE_PREFS_STORAGE_KEY,
} from "@/app/home/constants";
import {
  firstCapacityRegionInWatchScope,
  hasCapacity,
  hasCapacityInWatchScope,
  parseSnipePrefs,
  parseStoredCapacityAlerts,
} from "@/app/home/parsers";
import type {
  CapacityAlert,
  GpuRow,
  SnipePref,
  SshKey,
} from "@/app/home/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type WatchConfigMergeConflictPayload = {
  capacityAlerts: CapacityAlert[];
  snipePrefs: Record<string, SnipePref>;
};

function canonicalWatchPayload(
  alerts: CapacityAlert[],
  prefs: Record<string, SnipePref>
): string {
  const capacityAlertsSorted = [...alerts].sort(
    (a, b) =>
      a.instance_type_name.localeCompare(b.instance_type_name) ||
      (a.region_name ?? "").localeCompare(b.region_name ?? "")
  );
  const keys = Object.keys(prefs).sort();
  const snipePrefsSorted: Record<string, SnipePref> = {};
  for (const k of keys) {
    snipePrefsSorted[k] = prefs[k]!;
  }
  return JSON.stringify({ capacityAlerts: capacityAlertsSorted, snipePrefs: snipePrefsSorted });
}

function isWatchPayloadEmpty(
  alerts: CapacityAlert[],
  prefs: Record<string, SnipePref>
): boolean {
  return alerts.length === 0 && Object.keys(prefs).length === 0;
}

export function useCapacityAlerts({
  gpuRows,
  sshKeys,
  launchInstance,
  runningInstancesLength,
  launchBusy,
  launchCooldown,
  watchConfigSyncConfigured = false,
  watchConfigSyncSecret,
}: {
  gpuRows: GpuRow[];
  sshKeys: SshKey[];
  launchInstance: (
    instanceTypeName: string,
    regionName: string,
    sshKeyName: string
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  runningInstancesLength: number;
  launchBusy: boolean;
  launchCooldown: boolean;
  /** Mirrors server `LAMBDA_WATCH_CONFIG_PATH`; enables POST sync for MCP/tools. */
  watchConfigSyncConfigured?: boolean;
  /** Optional; pairs with server `LAMBDA_WATCH_CONFIG_SYNC_SECRET`. */
  watchConfigSyncSecret?: string | null;
}) {
  const [capacityAlerts, setCapacityAlerts] = useState<CapacityAlert[]>([]);
  const [snipePrefs, setSnipePrefs] = useState<Record<string, SnipePref>>({});
  const [snipeError, setSnipeError] = useState<string | null>(null);
  const [alertingTypes, setAlertingTypes] = useState<Set<string>>(
    () => new Set()
  );
  const [alertsHydrated, setAlertsHydrated] = useState(false);
  const [watchConfigMergeConflict, setWatchConfigMergeConflict] =
    useState<WatchConfigMergeConflictPayload | null>(null);
  const prevHadCapacityRef = useRef<Map<string, boolean>>(new Map());
  const latestAlertsRef = useRef(capacityAlerts);
  const latestPrefsRef = useRef(snipePrefs);
  useLayoutEffect(() => {
    latestAlertsRef.current = capacityAlerts;
    latestPrefsRef.current = snipePrefs;
  }, [capacityAlerts, snipePrefs]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(ALERT_STORAGE_KEY);
        if (raw) {
          const v = JSON.parse(raw) as unknown;
          setCapacityAlerts(parseStoredCapacityAlerts(v));
        }
      } catch {
        /* ignore */
      }
      setAlertsHydrated(true);
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(SNIPE_PREFS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        setSnipePrefs(parseSnipePrefs(parsed));
      } catch {
        /* ignore */
      }
    });
  }, []);

  const watchedTypeNames = useMemo(
    () => new Set(capacityAlerts.map((a) => a.instance_type_name)),
    [capacityAlerts]
  );

  useEffect(() => {
    const m = prevHadCapacityRef.current;
    for (const key of [...m.keys()]) {
      if (!watchedTypeNames.has(key)) m.delete(key);
    }
  }, [watchedTypeNames]);

  const displayRows = useMemo(() => {
    const byName = new Map(
      gpuRows.map((r) => [r.instance_type_name, r] as const)
    );
    const watchedOrdered = capacityAlerts
      .map((a) => byName.get(a.instance_type_name))
      .filter((r): r is GpuRow => Boolean(r));
    const rest = gpuRows
      .filter((r) => !watchedTypeNames.has(r.instance_type_name))
      .sort((a, b) =>
        a.instance_type_name.localeCompare(b.instance_type_name)
      );
    return [...watchedOrdered, ...rest];
  }, [gpuRows, capacityAlerts, watchedTypeNames]);

  const alertingKey = useMemo(
    () => [...alertingTypes].sort().join(","),
    [alertingTypes]
  );

  useEffect(() => {
    if (!gpuRows.length || !alertsHydrated) return;
    const known = new Set(gpuRows.map((r) => r.instance_type_name));
    queueMicrotask(() => {
      setCapacityAlerts((prev) => {
        const next = prev.filter((a) => known.has(a.instance_type_name));
        if (
          next.length === prev.length &&
          next.every(
            (a, i) =>
              a.instance_type_name === prev[i]?.instance_type_name &&
              a.region_name === prev[i]?.region_name
          )
        ) {
          return prev;
        }
        try {
          localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    });
  }, [gpuRows, alertsHydrated]);

  useEffect(() => {
    if (!gpuRows.length || !alertsHydrated) return;
    const known = new Set(gpuRows.map((r) => r.instance_type_name));
    const effectiveAlerts = capacityAlerts.filter((a) =>
      known.has(a.instance_type_name)
    );
    const watchedEffective = new Set(
      effectiveAlerts.map((a) => a.instance_type_name)
    );
    const work = new Map(prevHadCapacityRef.current);
    const next = new Set(alertingTypes);
    for (const name of [...next]) {
      if (!watchedEffective.has(name)) next.delete(name);
    }
    for (const { instance_type_name: name, region_name } of effectiveAlerts) {
      const region = region_name.trim();
      const row = gpuRows.find((r) => r.instance_type_name === name);
      if (!row) {
        next.delete(name);
        continue;
      }
      const now =
        region === ""
          ? hasCapacity(row)
          : hasCapacityInWatchScope(row, region);
      const prevCap = work.get(name);
      if (prevCap === undefined) {
        work.set(name, now);
        if (now) next.add(name);
        continue;
      }
      if (prevCap === false && now === true) next.add(name);
      if (!now && next.has(name)) next.delete(name);
      work.set(name, now);
    }
    prevHadCapacityRef.current = work;
    queueMicrotask(() => {
      setAlertingTypes((prev) => {
        if (prev.size === next.size && [...next].every((x) => prev.has(x))) {
          return prev;
        }
        return next;
      });
    });
    // alertingTypes omitted from deps on purpose: baseline for `next` is the
    // snapshot from the render that committed this gpuRows/capacityAlerts
    // change; ref holds cross-poll history. setAlertingTypes is a pure updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [gpuRows, capacityAlerts, alertsHydrated]);

  const persistCapacityAlerts = (next: CapacityAlert[]) => {
    try {
      localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const persistSnipePrefs = (next: Record<string, SnipePref>) => {
    try {
      localStorage.setItem(SNIPE_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const flushWatchPost = useCallback(
    (alertsArg: CapacityAlert[], prefsArg: Record<string, SnipePref>) => {
      if (!watchConfigSyncConfigured) return;
      const headers: HeadersInit = { "Content-Type": "application/json" };
      const sec = watchConfigSyncSecret?.trim();
      if (sec) headers["x-lambda-watch-sync-secret"] = sec;
      void fetch("/api/watch-config", {
        method: "POST",
        headers,
        body: JSON.stringify({
          capacityAlerts: alertsArg,
          snipePrefs: prefsArg,
        }),
      });
    },
    [watchConfigSyncConfigured, watchConfigSyncSecret]
  );

  const bootstrapWatchFromServerRanRef = useRef(false);

  useEffect(() => {
    if (
      !alertsHydrated ||
      !watchConfigSyncConfigured ||
      bootstrapWatchFromServerRanRef.current
    )
      return;
    bootstrapWatchFromServerRanRef.current = true;

    const alertsSnapshot = [...latestAlertsRef.current];
    const prefsSnapshot = { ...latestPrefsRef.current };
    let cancelled = false;

    void (async () => {
      const headers: HeadersInit = {};
      const sec = watchConfigSyncSecret?.trim();
      if (sec) headers["x-lambda-watch-sync-secret"] = sec;

      let res: Response;
      try {
        res = await fetch("/api/watch-config", { headers });
      } catch {
        return;
      }
      if (cancelled) return;

      let j: Record<string, unknown>;
      try {
        j = (await res.json()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!res.ok || j.ok !== true) return;

      const localMovedDuringFetch =
        canonicalWatchPayload(latestAlertsRef.current, latestPrefsRef.current) !==
        canonicalWatchPayload(alertsSnapshot, prefsSnapshot);
      if (localMovedDuringFetch) return;

      const serverAlerts = parseStoredCapacityAlerts(j.capacityAlerts);
      const serverSnipe = parseSnipePrefs(j.snipePrefs ?? {});

      if (
        canonicalWatchPayload(serverAlerts, serverSnipe) ===
        canonicalWatchPayload(alertsSnapshot, prefsSnapshot)
      ) {
        return;
      }

      if (isWatchPayloadEmpty(alertsSnapshot, prefsSnapshot)) {
        setCapacityAlerts(serverAlerts);
        setSnipePrefs(serverSnipe);
        persistCapacityAlerts(serverAlerts);
        persistSnipePrefs(serverSnipe);
        return;
      }

      setWatchConfigMergeConflict({
        capacityAlerts: serverAlerts,
        snipePrefs: serverSnipe,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [alertsHydrated, watchConfigSyncConfigured, watchConfigSyncSecret]);

  const resolveWatchConflictUseServer = useCallback(() => {
    const w = watchConfigMergeConflict;
    if (!w) return;
    persistCapacityAlerts(w.capacityAlerts);
    persistSnipePrefs(w.snipePrefs);
    setCapacityAlerts(w.capacityAlerts);
    setSnipePrefs(w.snipePrefs);
    setWatchConfigMergeConflict(null);
  }, [watchConfigMergeConflict]);

  const resolveWatchConflictKeepLocal = useCallback(() => {
    setWatchConfigMergeConflict(null);
    flushWatchPost(capacityAlerts, snipePrefs);
  }, [capacityAlerts, snipePrefs, flushWatchPost]);

  const onSnipePrefChange = useCallback(
    (instanceTypeName: string, next: SnipePref) => {
      setSnipePrefs((prev) => {
        const updated = { ...prev, [instanceTypeName]: next };
        persistSnipePrefs(updated);
        return updated;
      });
      setSnipeError(null);
    },
    []
  );

  const setCapacityAlertForType = useCallback(
    (name: string, enabled: boolean) => {
      if (enabled) {
        prevHadCapacityRef.current.delete(name);
        setCapacityAlerts((prev) => {
          if (prev.some((a) => a.instance_type_name === name)) return prev;
          const next = [...prev, { instance_type_name: name, region_name: "" }];
          persistCapacityAlerts(next);
          return next;
        });
        setSnipePrefs((prev) => {
          if (prev[name]) return prev;
          const updated = {
            ...prev,
            [name]: {
              enabled: false,
              ssh_key_name: sshKeys[0]?.name ?? "",
            },
          };
          persistSnipePrefs(updated);
          return updated;
        });
        return;
      }
      prevHadCapacityRef.current.delete(name);
      setCapacityAlerts((prev) => {
        const next = prev.filter((a) => a.instance_type_name !== name);
        persistCapacityAlerts(next);
        return next;
      });
      setSnipePrefs((prev) => {
        if (!(name in prev)) return prev;
        const rest = { ...prev };
        delete rest[name];
        persistSnipePrefs(rest);
        return rest;
      });
    },
    [sshKeys]
  );

  const setCapacityAlertRegion = useCallback(
    (instanceTypeName: string, region_name: string) => {
      setCapacityAlerts((prev) => {
        const idx = prev.findIndex(
          (a) => a.instance_type_name === instanceTypeName
        );
        if (idx < 0) return prev;
        if (prev[idx].region_name === region_name) return prev;
        prevHadCapacityRef.current.set(instanceTypeName, false);
        const next = [...prev];
        next[idx] = { ...next[idx], region_name };
        persistCapacityAlerts(next);
        return next;
      });
    },
    []
  );

  /**
   * Steady-state snipe: re-evaluates every render. As long as a snipe-enabled
   * type is currently in `alertingTypes` (i.e. capacity is present in its
   * scope), and the cap/cooldown/busy gates are clear, fire one launch per
   * render. `launchInstance` arms a 12s cooldown after each attempt and the
   * `runningInstancesLength > 0` gate stops further launches once we succeed,
   * so this won't spam. Standing capacity at page load is captured because the
   * trigger no longer depends on a false→true edge.
   */
  useEffect(() => {
    if (!alertsHydrated) return;
    if (alertingTypes.size === 0) return;
    if (runningInstancesLength > 0 || launchBusy || launchCooldown) return;

    const candidates: string[] = [];
    alertingTypes.forEach((n) => {
      if (snipePrefs[n]?.enabled) candidates.push(n);
    });
    if (candidates.length === 0) return;

    void (async () => {
      for (const name of candidates) {
        const prefs = snipePrefs[name];
        if (!prefs?.enabled) continue;
        const row = gpuRows.find((r) => r.instance_type_name === name);
        if (!row || !hasCapacity(row)) continue;
        const watchRegion =
          capacityAlerts.find((a) => a.instance_type_name === name)
            ?.region_name.trim() ?? "";
        const launchRegionName = watchRegion
          ? firstCapacityRegionInWatchScope(row, watchRegion) ?? ""
          : row.regions_with_capacity_available[0]?.name ?? "";
        if (watchRegion && !hasCapacityInWatchScope(row, watchRegion)) {
          continue;
        }
        const keyName = prefs.ssh_key_name.trim() || sshKeys[0]?.name || "";
        if (!launchRegionName || !keyName) continue;

        const r = await launchInstance(name, launchRegionName, keyName);
        if (!r.ok) {
          setSnipeError(`${name}: ${r.message}`);
          break;
        }
        setSnipeError(null);
        setCapacityAlertForType(name, false);
        break;
      }
    })();
  }, [
    alertingKey,
    alertsHydrated,
    alertingTypes,
    snipePrefs,
    gpuRows,
    runningInstancesLength,
    launchBusy,
    launchCooldown,
    sshKeys,
    launchInstance,
    capacityAlerts,
    setCapacityAlertForType,
  ]);

  const gpuRowsSortedForSetup = useMemo(
    () =>
      [...gpuRows].sort((a, b) =>
        a.instance_type_name.localeCompare(b.instance_type_name)
      ),
    [gpuRows]
  );

  const alertsSetupSummary = useMemo(() => {
    const n = capacityAlerts.length;
    return n === 0 ? "No capacity alerts" : `${n} alert${n === 1 ? "" : "s"}`;
  }, [capacityAlerts]);

  useEffect(() => {
    if (
      !alertsHydrated ||
      !watchConfigSyncConfigured ||
      watchConfigMergeConflict !== null
    )
      return;
    const id = window.setTimeout(() => {
      flushWatchPost(capacityAlerts, snipePrefs);
    }, 450);
    return () => window.clearTimeout(id);
  }, [
    capacityAlerts,
    snipePrefs,
    alertsHydrated,
    watchConfigSyncConfigured,
    flushWatchPost,
    watchConfigMergeConflict,
  ]);

  return {
    alertsHydrated,
    capacityAlerts,
    snipePrefs,
    snipeError,
    alertingTypes,
    alertingKey,
    displayRows,
    setCapacityAlertForType,
    setCapacityAlertRegion,
    onSnipePrefChange,
    gpuRowsSortedForSetup,
    alertsSetupSummary,
    watchConfigMergeConflict,
    resolveWatchConflictUseServer,
    resolveWatchConflictKeepLocal,
  };
}
