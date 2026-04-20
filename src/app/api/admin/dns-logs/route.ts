import { NextRequest, NextResponse } from "next/server";
import { getAdGuardLogs } from "@/lib/adguard";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // Verificação de autenticação admin
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  const isValid = await verifySessionToken(token);
  
  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const ip = searchParams.get("ip");

  if (!ip) {
    return NextResponse.json({ error: "IP address is required" }, { status: 400 });
  }

  try {
    const logs = await getAdGuardLogs(ip);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("API Route Error (dns-logs):", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch DNS logs" },
      { status: 500 }
    );
  }
}
