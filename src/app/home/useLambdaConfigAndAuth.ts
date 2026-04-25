"use client";

import type { ConfigStatus } from "@/app/home/types";
import { buildAuthHeaders, buildPemHeaders } from "@/app/home/headers";
import { DEFAULT_POLL_SECONDS, MIN_POLL_SECONDS } from "@/app/home/constants";
import { useCallback, useEffect, useMemo, useState } from "react";

export function useLambdaConfigAndAuth() {
  const [apiKeyOverride, setApiKeyOverride] = useState("");
  const [pemOverride, setPemOverride] = useState("");
  const [intervalInput, setIntervalInput] = useState(
    String(DEFAULT_POLL_SECONDS)
  );
  const [intervalSec, setIntervalSec] = useState(DEFAULT_POLL_SECONDS);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [resolvedPemPath, setResolvedPemPath] = useState<string | null>(null);
  const [resolvedPemSource, setResolvedPemSource] = useState<
    "header" | "env" | "none"
  >("none");
  const [lambdaRateLimitHit, setLambdaRateLimitHit] = useState(false);

  const authHeaders = useMemo(
    () => buildAuthHeaders(apiKeyOverride),
    [apiKeyOverride]
  );
  const pemHeaders = useMemo(
    () => buildPemHeaders(pemOverride),
    [pemOverride]
  );

  const applyLambdaHttpStatus = useCallback((res: Response) => {
    setLambdaRateLimitHit((prev) => {
      if (res.status === 429) return true;
      if (res.ok) return false;
      return prev;
    });
  }, []);

  const apiKeyBadge = useMemo(() => {
    if (apiKeyOverride.trim())
      return { label: "API key: UI override", ok: true };
    if (configStatus?.apiKeyConfigured)
      return { label: "API key: detected in .env", ok: true };
    return { label: "API key: missing", ok: false };
  }, [apiKeyOverride, configStatus]);

  const pemBadge = useMemo(() => {
    if (pemOverride.trim())
      return { label: "PEM path: UI override", ok: true };
    if (configStatus?.pemPathConfigured)
      return {
        label: `PEM path: detected in .env${
          configStatus.pemPathFilename
            ? ` (${configStatus.pemPathFilename})`
            : ""
        }`,
        ok: true,
      };
    return {
      label: "PEM path: not set (SSH command will use placeholder)",
      ok: false,
    };
  }, [pemOverride, configStatus]);

  useEffect(() => {
    fetch("/api/config-status")
      .then((r) => r.json())
      .then((j: ConfigStatus) => setConfigStatus(j))
      .catch(() => setConfigStatus(null));
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/resolved-pem-path", {
      headers: pemHeaders,
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then(
        (j: { path: string | null; source: "header" | "env" | "none" }) => {
          setResolvedPemPath(j.path);
          setResolvedPemSource(j.source);
        }
      )
      .catch(() => {
        setResolvedPemPath(null);
        setResolvedPemSource("none");
      });
    return () => ac.abort();
  }, [pemHeaders]);

  const applyInterval = () => {
    const n = Number(intervalInput);
    if (Number.isFinite(n) && n >= MIN_POLL_SECONDS) {
      setIntervalSec(n);
    } else {
      const clamped = MIN_POLL_SECONDS;
      setIntervalInput(String(clamped));
      setIntervalSec(clamped);
    }
  };

  return {
    apiKeyOverride,
    setApiKeyOverride,
    pemOverride,
    setPemOverride,
    intervalInput,
    setIntervalInput,
    intervalSec,
    applyInterval,
    configStatus,
    resolvedPemPath,
    resolvedPemSource,
    authHeaders,
    pemHeaders,
    applyLambdaHttpStatus,
    lambdaRateLimitHit,
    apiKeyBadge,
    pemBadge,
  };
}
