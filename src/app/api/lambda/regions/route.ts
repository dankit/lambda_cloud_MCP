import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/credentials";
import { lambdaFetch } from "@/lib/lambda";

export async function GET(req: NextRequest) {
  const { key } = resolveApiKey(req.headers.get("x-lambda-api-key"));
  if (!key) {
    return NextResponse.json(
      {
        error: {
          code: "missing-api-key",
          message:
            "Configure LAMBDA_API_KEY in .env or enter an API key in the UI (sent as X-Lambda-Api-Key).",
        },
      },
      { status: 401 }
    );
  }
  const { ok, status, body } = await lambdaFetch("/regions", {
    apiKey: key,
  });
  return NextResponse.json(body, { status: ok ? 200 : status });
}
