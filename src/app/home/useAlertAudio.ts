"use client";

import { TEST_ALERT_MS } from "@/app/home/constants";
import { useCallback, useEffect, useRef, useState } from "react";

export function useAlertAudio(
  alertingTypes: Set<string>,
  alertingKey: string
) {
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [testBeepUntil, setTestBeepUntil] = useState(0);
  const [testPreviewActive, setTestPreviewActive] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const beepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const unlock = () => {
      const Ctx =
        window.AudioContext ||
        (
          window as unknown as {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      void audioCtxRef.current.resume().catch(() => {});
      setAudioUnlocked(true);
    };
    document.addEventListener("pointerdown", unlock, {
      passive: true,
      once: true,
    });
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  const playBeep = useCallback(() => {
    const Ctx =
      window.AudioContext ||
      (
        window as unknown as {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!Ctx) return;
    const ctx = audioCtxRef.current ?? new Ctx();
    audioCtxRef.current = ctx;
    if (ctx.state !== "running") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.13);
  }, []);

  useEffect(() => {
    if (beepIntervalRef.current) {
      clearInterval(beepIntervalRef.current);
      beepIntervalRef.current = null;
    }
    if (!audioUnlocked) return;
    const testOn = testBeepUntil > 0 && Date.now() < testBeepUntil;
    if (alertingTypes.size === 0 && !testOn) return;
    playBeep();
    beepIntervalRef.current = setInterval(() => {
      playBeep();
    }, 1200);
    return () => {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current);
        beepIntervalRef.current = null;
      }
    };
  }, [
    alertingKey,
    alertingTypes.size,
    audioUnlocked,
    playBeep,
    testBeepUntil,
  ]);

  useEffect(() => {
    return () => {
      if (beepIntervalRef.current) clearInterval(beepIntervalRef.current);
      void audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const ensureAudioUnlockedFromGesture = useCallback(() => {
    const Ctx =
      window.AudioContext ||
      (
        window as unknown as {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    void audioCtxRef.current.resume().catch(() => {});
    setAudioUnlocked(true);
  }, []);

  /** Same beep path as real alerts, but resumes AudioContext inside this click (capacity alerts cannot). */
  const runTestAlert = useCallback(() => {
    ensureAudioUnlockedFromGesture();
    const until = Date.now() + TEST_ALERT_MS;
    setTestBeepUntil(until);
    setTestPreviewActive(true);
    window.setTimeout(() => {
      setTestBeepUntil(0);
      setTestPreviewActive(false);
    }, TEST_ALERT_MS + 80);
  }, [ensureAudioUnlockedFromGesture]);

  return {
    audioUnlocked,
    testBeepUntil,
    testPreviewActive,
    runTestAlert,
  };
}
