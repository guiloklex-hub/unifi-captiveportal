import { NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE } from "../auth";
import type { LoginResult } from "./login";

export function sessionResponse(result: Extract<LoginResult, { status: "ok" }>): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}

export function lockedResponse(until: Date): NextResponse {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return NextResponse.json({ error: `Conta bloqueada temporariamente. Tente em ${minutes} min.` }, { status: 423 });
}
