import { NextRequest, NextResponse } from "next/server";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { clientIp } from "@/lib/rateLimit";
import { getSystemSettings } from "@/lib/settings";
import type { GuestRegistrationInput } from "@/lib/validators";
import { grantGuestAccess } from "@/lib/portal/grantAccess";
import { portalRateLimit } from "@/lib/portal/rateLimit";
import { accessRequestFrom } from "@/lib/portal/form";
import { verifyOtp } from "@/lib/portal/otp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const dict = dictionaries[getLocale(req.headers.get("accept-language"))];
  const settings = await getSystemSettings();

  const body = (await req.json().catch(() => null)) as { challengeId?: unknown; code?: unknown; mac?: unknown } | null;
  const ip = clientIp(req.headers);
  const limited = portalRateLimit("otp-verify", ip, body, dict);
  if (limited) return limited;

  const challengeId = typeof body?.challengeId === "string" ? body.challengeId : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const mac = typeof body?.mac === "string" ? body.mac : "";
  if (!challengeId || !code || !mac) return NextResponse.json({ error: dict.portal.errInvalidData }, { status: 400 });

  const result = await verifyOtp<GuestRegistrationInput & { termsHash?: string }>(challengeId, code, mac);
  if (!result.ok) {
    const message =
      result.reason === "invalid_code"
        ? dict.portal.errOtpInvalid
        : result.reason === "too_many_attempts"
          ? dict.portal.errOtpTooMany
          : dict.portal.errOtpExpired;
    return NextResponse.json({ error: message, reason: result.reason }, { status: 400 });
  }

  const grant = await grantGuestAccess(
    accessRequestFrom(result.payload, result.channel === "email" ? "otp-email" : "otp-sms", {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: ip !== "unknown" ? ip : undefined,
      termsHash: result.payload.termsHash ?? null,
    }),
    settings,
    dict,
  );
  if (!grant.ok) return NextResponse.json({ error: grant.error }, { status: grant.status });
  return NextResponse.json({ ok: true, id: grant.id, redirect: grant.redirect });
}
