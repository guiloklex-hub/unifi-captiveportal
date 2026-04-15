import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.redirect(
    new URL("/admin/login", process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"),
  );
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
