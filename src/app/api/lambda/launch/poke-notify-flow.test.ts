import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lambda", () => ({
  lambdaFetch: vi.fn(),
}));

import { POST } from "@/app/api/lambda/launch/route";
import { lambdaFetch } from "@/lib/lambda";

const POKE_URL = "https://poke.com/api/v1/inbound/api-message";

const nativeFetch = globalThis.fetch.bind(globalThis);

function launchRequestBody() {
  return {
    region_name: "us-east-1",
    instance_type_name: "gpu_1x_a100",
    ssh_key_name: "mykey",
  };
}

function buildLaunchRequest() {
  return new NextRequest("http://localhost/api/lambda/launch", {
    method: "POST",
    headers: {
      "x-lambda-api-key": "test-lambda-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(launchRequestBody()),
  });
}

describe("launch route → Poke notify flow", () => {
  beforeEach(() => {
    vi.mocked(lambdaFetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { data: { instance_ids: ["fake-instance-id"] } },
    });
  });

  afterEach(() => {
    vi.mocked(lambdaFetch).mockReset();
  });

  it.skipIf(!process.env.POKE_API_KEY?.trim())(
    "calls real Poke api-message after mocked successful launch (set POKE_API_KEY)",
    async () => {
      const pokeKey = process.env.POKE_API_KEY!.trim();
      let pokeResponse: Response | null = null;
      let pokeInit: RequestInit | undefined;

      vi.stubGlobal(
        "fetch",
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1]
        ) => {
          const url = String(input);
          const res = await nativeFetch(input, init);
          if (url === POKE_URL || url.startsWith(`${POKE_URL}?`)) {
            pokeInit = init;
            pokeResponse = res.clone();
          }
          return res;
        }
      );

      try {
        const res = await POST(buildLaunchRequest());
        expect(res.status).toBe(200);

        expect(lambdaFetch).toHaveBeenCalledWith(
          "/instance-operations/launch",
          expect.objectContaining({
            method: "POST",
            apiKey: "test-lambda-key",
            body: {
              region_name: "us-east-1",
              instance_type_name: "gpu_1x_a100",
              ssh_key_names: ["mykey"],
            },
          })
        );

        expect(pokeResponse).not.toBeNull();
        const pr = pokeResponse!;
        const pokeBodyText = await pr.text();
        if (!pr.ok) {
          throw new Error(
            `Poke returned HTTP ${pr.status} (not 2xx). Body (first 600 chars): ${pokeBodyText.slice(0, 600)}`
          );
        }
        let pokeJson: { success?: boolean };
        try {
          pokeJson = JSON.parse(pokeBodyText) as { success?: boolean };
        } catch {
          throw new Error(
            `Poke body was not JSON (HTTP ${pr.status}). First 600 chars: ${pokeBodyText.slice(0, 600)}`
          );
        }
        if (pokeJson.success !== true) {
          throw new Error(
            `Poke JSON did not report success: ${JSON.stringify(pokeJson)}`
          );
        }

        // HTTP 200 + success:true means the API accepted the message; the in-app thread may still need a refresh or correct account.
        console.info(
          `[poke-notify-flow] Poke API accepted the message (HTTP ${pr.status}). If nothing appears in the app, refresh the conversation and check notifications / the Kitchen key’s workspace.`
        );

        expect(pokeInit).toBeDefined();
        const headers = new Headers(pokeInit?.headers as HeadersInit);
        expect(headers.get("Authorization")).toBe(`Bearer ${pokeKey}`);
        expect(headers.get("Content-Type")).toBe("application/json");
        const body = JSON.parse(pokeInit?.body as string) as { message: string };
        expect(body.message).toContain("Lambda GPU launch succeeded.");
        expect(body.message).toContain("fake-instance-id");
      } finally {
        vi.unstubAllGlobals();
      }
    }
  );

  describe("with mocked global fetch", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("POSTs to Poke with launch-shaped message when POKE_API_KEY is set (mocked fetch)", async () => {
      const savedPoke = process.env.POKE_API_KEY;
      process.env.POKE_API_KEY = "test-poke-key";
      try {
        const res = await POST(buildLaunchRequest());
        expect(res.status).toBe(200);

        expect(lambdaFetch).toHaveBeenCalledWith(
          "/instance-operations/launch",
          expect.objectContaining({
            method: "POST",
            apiKey: "test-lambda-key",
            body: {
              region_name: "us-east-1",
              instance_type_name: "gpu_1x_a100",
              ssh_key_names: ["mykey"],
            },
          })
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [
          string,
          RequestInit | undefined,
        ];
        expect(url).toBe(POKE_URL);
        expect(init?.method).toBe("POST");
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer test-poke-key");
        expect(headers["Content-Type"]).toBe("application/json");
        const body = JSON.parse(init?.body as string) as { message: string };
        expect(body.message).toContain("Lambda GPU launch succeeded.");
        expect(body.message).toContain("Instance type: gpu_1x_a100");
        expect(body.message).toContain("Region: us-east-1");
        expect(body.message).toContain("SSH key name: mykey");
        expect(body.message).toContain("fake-instance-id");
      } finally {
        if (savedPoke === undefined) delete process.env.POKE_API_KEY;
        else process.env.POKE_API_KEY = savedPoke;
      }
    });

    it("does not call Poke when POKE_API_KEY is unset", async () => {
      const saved = process.env.POKE_API_KEY;
      delete process.env.POKE_API_KEY;

      try {
        const req = new NextRequest("http://localhost/api/lambda/launch", {
          method: "POST",
          headers: {
            "x-lambda-api-key": "test-lambda-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            region_name: "us-west-1",
            instance_type_name: "gpu_1x_h100",
            ssh_key_name: "k",
          }),
        });

        await POST(req);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        if (saved !== undefined) process.env.POKE_API_KEY = saved;
        else delete process.env.POKE_API_KEY;
      }
    });
  });
});
