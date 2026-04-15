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
  const res = NextResponse.redirect(new URL("/admin/login", req.url));
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
