import { NextRequest, NextResponse } from "next/server";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { clientIp } from "@/lib/rateLimit";
import { getSystemSettings } from "@/lib/settings";
import { unifiContextSchema } from "@/lib/validators";
import { grantGuestAccess } from "@/lib/portal/grantAccess";
import { findReturningGuest } from "@/lib/portal/returning";
import { findAllowRule } from "@/lib/portal/accessRules";
import { currentTermsHash } from "@/lib/privacy";
import { portalRateLimit } from "@/lib/portal/rateLimit";

export const runtime = "nodejs";

/** Reconexão com um clique para dispositivos já cadastrados (ver lib/portal/returning.ts). */
export async function POST(req: NextRequest) {
  const dict = dictionaries[getLocale(req.headers.get("accept-language"))];
  const settings = await getSystemSettings();

  const body = await req.json().catch(() => null);
  const ip = clientIp(req.headers);
  const limited = portalRateLimit("reconnect", ip, body, dict);
  if (limited) return limited;

  const parsed = unifiContextSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: dict.portal.errInvalidData }, { status: 400 });
  const ctx = parsed.data;

  // Dispositivo liberado pelo admin tem precedência sobre o "lembrar dispositivo".
  const allow = await findAllowRule(ctx.mac);
  const termsHash = await currentTermsHash(settings, ctx.site);
  const returning = allow ? null : await findReturningGuest(ctx.mac, settings, termsHash);
  // 410: o cliente deve cair para o formulário normal.
  if (!allow && !returning) return NextResponse.json({ error: dict.portal.errReturningExpired }, { status: 410 });

  const result = await grantGuestAccess(
    {
      identity: returning?.identity ?? { fullName: "", email: "", phone: "", cpf: "", documentType: null, document: null },
      mac: ctx.mac,
      apMac: ctx.apMac,
      ssid: ctx.ssid,
      site: ctx.site,
      originalUrl: ctx.originalUrl,
      fingerprint: ctx.fingerprint ?? null,
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: ip !== "unknown" ? ip : undefined,
      authMethod: allow ? "allowlist" : "returning",
      adminGrant: allow ? { minutes: allow.durationMin } : undefined,
      consent: returning?.consent,
    },
    settings,
    dict,
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, id: result.id, redirect: result.redirect });
}
