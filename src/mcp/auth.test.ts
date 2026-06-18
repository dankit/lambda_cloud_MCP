import { afterEach, describe, expect, it } from "vitest";
import {
  extractBearerToken,
  isAuthorized,
  resolveMcpHttpSecret,
} from "./auth";

describe("extractBearerToken", () => {
  it("parses a bearer token case-insensitively", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer  abc123  ")).toBe("abc123");
  });
  it("returns null for missing or malformed headers", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
  });
});

describe("isAuthorized", () => {
  it("accepts the exact secret", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });
  it("rejects wrong, missing, or differently-sized tokens", () => {
    expect(isAuthorized("Bearer nope", "s3cret")).toBe(false);
    expect(isAuthorized("Bearer s3cre", "s3cret")).toBe(false);
    expect(isAuthorized(undefined, "s3cret")).toBe(false);
  });
});

describe("resolveMcpHttpSecret", () => {
  const saved = process.env.LAMBDA_MCP_HTTP_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.LAMBDA_MCP_HTTP_SECRET;
    else process.env.LAMBDA_MCP_HTTP_SECRET = saved;
  });
  it("returns null when unset or blank", () => {
    delete process.env.LAMBDA_MCP_HTTP_SECRET;
    expect(resolveMcpHttpSecret()).toBeNull();
    process.env.LAMBDA_MCP_HTTP_SECRET = "   ";
    expect(resolveMcpHttpSecret()).toBeNull();
  });
  it("returns the trimmed secret when set", () => {
    process.env.LAMBDA_MCP_HTTP_SECRET = "  tok  ";
    expect(resolveMcpHttpSecret()).toBe("tok");
  });
});
