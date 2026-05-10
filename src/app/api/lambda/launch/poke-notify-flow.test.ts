import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lambda", () => ({
  lambdaFetch: vi.fn(),
}));

import { POST } from "@/app/api/lambda/launch/route";
import { lambdaFetch } from "@/lib/lambda";

const POKE_URL = "https://poke.com/api/v1/inbound/api-message";

describe("launch route → Poke notify flow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(lambdaFetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { data: { instance_ids: ["fake-instance-id"] } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(lambdaFetch).mockReset();
    delete process.env.POKE_API_KEY;
  });

  it("POSTs to Poke with launch-shaped message when launch succeeds and POKE_API_KEY is set", async () => {
    process.env.POKE_API_KEY = "test-poke-key";

    const req = new NextRequest("http://localhost/api/lambda/launch", {
      method: "POST",
      headers: {
        "x-lambda-api-key": "test-lambda-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        region_name: "us-east-1",
        instance_type_name: "gpu_1x_a100",
        ssh_key_name: "mykey",
      }),
    });

    const res = await POST(req);
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
  });

  it("does not call Poke when POKE_API_KEY is unset", async () => {
    delete process.env.POKE_API_KEY;

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
  });
});
