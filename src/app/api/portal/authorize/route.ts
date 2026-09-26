import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGuestRegistrationSchema } from "@/lib/validators";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { clientIp } from "@/lib/rateLimit";
import { getSystemSettings } from "@/lib/settings";
import { grantGuestAccess } from "@/lib/portal/grantAccess";
import { portalRateLimit } from "@/lib/portal/rateLimit";

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

  const parsed = getGuestRegistrationSchema(dict.validation, settings).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: dict.portal.errInvalidData, issues: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const result = await grantGuestAccess(
    {
      identity: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        cpf: data.cpf,
        documentType: data.documentType,
        document: data.document,
      },
      mac: data.mac,
      apMac: data.apMac,
      ssid: data.ssid,
      site: data.site,
      originalUrl: data.originalUrl,
      fingerprint: data.fingerprint ?? null,
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: ip !== "unknown" ? ip : undefined,
      token: data.token,
      authMethod: "form",
    },
    settings,
    dict,
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, id: result.id, redirect: result.redirect });
}
