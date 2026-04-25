import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/credentials";
import { lambdaFetch } from "@/lib/lambda";

type LaunchBody = {
  region_name?: string;
  instance_type_name?: string;
  ssh_key_name?: string;
};

export async function POST(req: NextRequest) {
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
  let json: LaunchBody;
  try {
    json = (await req.json()) as LaunchBody;
  } catch {
    return NextResponse.json(
      { error: { code: "invalid-json", message: "Request body must be JSON." } },
      { status: 400 }
    );
  }
  const { region_name, instance_type_name, ssh_key_name } = json;
  if (!region_name || !instance_type_name || !ssh_key_name) {
    return NextResponse.json(
      {
        error: {
          code: "invalid-parameters",
          message:
            "region_name, instance_type_name, and ssh_key_name are required.",
        },
      },
      { status: 400 }
    );
  }
  const { ok, status, body } = await lambdaFetch("/instance-operations/launch", {
    method: "POST",
    apiKey: key,
    body: {
      region_name,
      instance_type_name,
      ssh_key_names: [ssh_key_name],
    },
  });
  return NextResponse.json(body, { status: ok ? 200 : status });
}
