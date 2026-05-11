import { describe, expect, it } from "vitest";
import {
  applyParameterPlaceholders,
  buildExportPrefix,
  buildTemplatedCommand,
  shellSingleQuoteValue,
} from "./command-template";

describe("shellSingleQuoteValue", () => {
  it("wraps and escapes single quotes", () => {
    expect(shellSingleQuoteValue("a'b")).toBe("'a'\"'\"'b'");
  });
});

describe("buildExportPrefix", () => {
  it("returns empty for empty env", () => {
    expect(buildExportPrefix({})).toBe("");
  });
  it("chains exports", () => {
    expect(buildExportPrefix({ EPOCHS: "3" })).toBe("export EPOCHS='3' && ");
  });
});

describe("applyParameterPlaceholders", () => {
  it("replaces known keys", () => {
    expect(
      applyParameterPlaceholders("train.py --epochs {{epochs}}", { epochs: "10" }, false)
    ).toBe("train.py --epochs 10");
  });
  it("leaves unknown when not strict", () => {
    expect(applyParameterPlaceholders("x {{missing}}", {}, false)).toBe("x {{missing}}");
  });
  it("throws when strict and missing", () => {
    expect(() =>
      applyParameterPlaceholders("x {{missing}}", {}, true)
    ).toThrow("Missing parameter");
  });
});

describe("buildTemplatedCommand", () => {
  it("combines env prefix and placeholders", () => {
    const cmd = buildTemplatedCommand("python train.py {{extra}}", {
      parameters: { extra: "--fp16" },
      env: { CUDA_VISIBLE_DEVICES: "0" },
    });
    expect(cmd).toBe("export CUDA_VISIBLE_DEVICES='0' && python train.py --fp16");
  });
});
