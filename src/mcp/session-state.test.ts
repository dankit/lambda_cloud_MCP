import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllSessions,
  getSession,
  mergeSession,
  resetSession,
} from "./session-state";

beforeEach(() => {
  clearAllSessions();
});

describe("mergeSession", () => {
  it("returns empty for an unknown instance", () => {
    expect(getSession("i-1")).toEqual({});
  });
  it("stores workdir and env", () => {
    const next = mergeSession("i-1", { workdir: "/work", env: { A: "1" } });
    expect(next).toEqual({ workdir: "/work", env: { A: "1" } });
    expect(getSession("i-1")).toEqual({ workdir: "/work", env: { A: "1" } });
  });
  it("merges env keys across calls and overrides workdir", () => {
    mergeSession("i-1", { workdir: "/work", env: { A: "1" } });
    const next = mergeSession("i-1", { workdir: "/work2", env: { B: "2" } });
    expect(next).toEqual({ workdir: "/work2", env: { A: "1", B: "2" } });
  });
  it("ignores blank workdir and empty env", () => {
    mergeSession("i-1", { workdir: "/work", env: { A: "1" } });
    const next = mergeSession("i-1", { workdir: "   ", env: {} });
    expect(next).toEqual({ workdir: "/work", env: { A: "1" } });
  });
  it("reset clears prior state before applying the update", () => {
    mergeSession("i-1", { workdir: "/work", env: { A: "1" } });
    const next = mergeSession("i-1", { reset: true, env: { B: "2" } });
    expect(next).toEqual({ env: { B: "2" } });
  });
});

describe("resetSession", () => {
  it("removes stored state", () => {
    mergeSession("i-1", { workdir: "/work" });
    resetSession("i-1");
    expect(getSession("i-1")).toEqual({});
  });
});
