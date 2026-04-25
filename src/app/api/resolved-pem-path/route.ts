import { NextRequest, NextResponse } from "next/server";
import { resolvePemPath } from "@/lib/credentials";

/** Returns the PEM path that will be used for SSH suggestions (header override > .env). */
export async function GET(req: NextRequest) {
  const { path: pemPath, source } = resolvePemPath(
    req.headers.get("x-lambda-ssh-pem-path")
  );
  return NextResponse.json({ path: pemPath, source });
}
