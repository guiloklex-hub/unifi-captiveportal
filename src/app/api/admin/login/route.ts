import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  checkAdminPassword,
  createSessionToken,
} from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Resposta única para senha errada / rate-limit — não vaza qual ocorreu.
const INVALID = { error: "Credenciais inválidas" } as const;

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`admin-login:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    logger.warn({ ip, resetAt: rl.resetAt }, "admin login rate-limited");
    return NextResponse.json(INVALID, {
      status: 401,
      headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
    });
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await checkAdminPassword(password))) {
    logger.info({ ip }, "admin login failed");
    return NextResponse.json(INVALID, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  logger.info({ ip }, "admin login ok");
  return res;
}
