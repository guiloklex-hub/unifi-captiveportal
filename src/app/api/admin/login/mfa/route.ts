import { NextRequest, NextResponse } from "next/server";
import { verifyMfaToken } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { mfaLogin } from "@/lib/admin/login";
import { audit } from "@/lib/admin/audit";
import { lockedResponse, sessionResponse } from "@/lib/admin/loginResponse";

export const runtime = "nodejs";

/** Segundo fator: código do aplicativo autenticador. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const uid = await verifyMfaToken(typeof body.mfaToken === "string" ? body.mfaToken : "");
  if (!uid) return NextResponse.json({ error: "Sessão de login expirada. Entre novamente." }, { status: 401 });

  const rl = rateLimit(`admin-mfa:${clientIp(req.headers)}:${uid}`, 5, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });

  const result = await mfaLogin(uid, typeof body.code === "string" ? body.code : "");
  if (result.status === "locked") return lockedResponse(result.until);
  if (result.status !== "ok") {
    await audit(req, "login.mfa_failed", uid, undefined, uid);
    return NextResponse.json({ error: "Código inválido" }, { status: 401 });
  }
  await audit(req, "login.success", result.username, { mfa: true }, result.username);
  return sessionResponse(result);
}
