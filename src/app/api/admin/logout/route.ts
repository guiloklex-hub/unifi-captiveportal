import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return logout(req);
}

export async function POST(req: NextRequest) {
  return logout(req);
}

async function logout(req: NextRequest) {
  const host = req.headers.get("host") || req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.split(":")[0];
  const res = NextResponse.redirect(`${protocol}://${host}/admin/login`);
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
