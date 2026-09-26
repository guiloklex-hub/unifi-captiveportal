import { NextRequest, NextResponse } from "next/server";
import { createMfaToken } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { passwordLogin } from "@/lib/admin/login";
import { lockedResponse, sessionResponse } from "@/lib/admin/loginResponse";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Resposta única para senha errada / rate-limit — não vaza qual ocorreu.
const INVALID = { error: "Credenciais inválidas" } as const;

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Limite por IP+usuário: sem proxy reverso o IP é "unknown" para todos, e um
  // limite só por IP permitiria que qualquer um travasse o login do admin.
  const rl = rateLimit(`admin-login:${ip}:${username.toLowerCase()}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    logger.warn({ ip, resetAt: rl.resetAt }, "admin login rate-limited");
    return NextResponse.json(INVALID, {
      status: 401,
      headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
    });
  }

  const result = await passwordLogin(username, password);
  if (result.status === "invalid") {
    logger.info({ ip, username }, "admin login failed");
    await audit(req, "login.failed", username || "admin", undefined, username || "admin");
    return NextResponse.json(INVALID, { status: 401 });
  }
  if (result.status === "locked") return lockedResponse(result.until);
  if (result.status === "mfa") {
    return NextResponse.json({ mfaRequired: true, mfaToken: await createMfaToken(result.uid) });
  }

  logger.info({ ip, username: result.username }, "admin login ok");
  await audit(req, "login.success", result.username, undefined, result.username);
  return sessionResponse(result);
}
