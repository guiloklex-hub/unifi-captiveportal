import { NextRequest, NextResponse } from "next/server";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { clientIp } from "@/lib/rateLimit";
import { getSystemSettings } from "@/lib/settings";
import { grantGuestAccess, type AuthMethod } from "@/lib/portal/grantAccess";
import { portalRateLimit } from "@/lib/portal/rateLimit";
import { accessRequestFrom, parseGuestForm } from "@/lib/portal/form";
import { consumeSocialTicket } from "@/lib/portal/oauth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const dict = dictionaries[getLocale(req.headers.get("accept-language"))];
  const settings = await getSystemSettings();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: dict.portal.errInvalidData }, { status: 400 });
  }

  const ip = clientIp(req.headers);
  const limited = portalRateLimit("authorize", ip, body, dict);
  if (limited) return limited;

  const form = parseGuestForm(body, settings, dict);
  if (!form.ok) return NextResponse.json(form.body, { status: form.status });
  const data = form.data;

  // Login social: nome/e-mail vêm do provedor (verificados), não do formulário.
  let authMethod: AuthMethod = "form";
  const socialTicket = (body as { socialTicket?: unknown })?.socialTicket;
  if (typeof socialTicket === "string" && socialTicket) {
    const social = await consumeSocialTicket(socialTicket, data.mac);
    if (!social) return NextResponse.json({ error: dict.portal.errSocialExpired }, { status: 400 });
    data.fullName = social.name;
    data.email = social.email;
    authMethod = social.provider;
  } else if (settings.verificationMode !== "none") {
    // Com verificação ligada, a autorização direta só passa por /otp/verify.
    return NextResponse.json({ error: dict.portal.errVerificationRequired }, { status: 403 });
  }

  const result = await grantGuestAccess(
    accessRequestFrom(data, authMethod, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: ip !== "unknown" ? ip : undefined,
    }),
    settings,
    dict,
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, id: result.id, redirect: result.redirect });
}
