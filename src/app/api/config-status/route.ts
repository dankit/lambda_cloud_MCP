import { NextResponse } from "next/server";
import { envConfigSnapshot } from "@/lib/credentials";

export async function GET() {
  return NextResponse.json(envConfigSnapshot());
}
