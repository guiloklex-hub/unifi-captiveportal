import { NextResponse } from "next/server";
import { getTokenLocks } from "@/lib/tokenLocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getTokenLocks());
}
