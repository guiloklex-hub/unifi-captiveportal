import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSystemSettings } from "@/lib/settings";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { grantGuestAccess } from "@/lib/portal/grantAccess";
import { requireApiKey } from "@/lib/integrations/apiKeys";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

const schema = z.object({
  mac: z.string().trim().regex(/^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i),
  minutes: z.coerce.number().int().min(1).max(525_600),
  site: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().nullable(),
  label: z.string().trim().max(120).optional().nullable(),
});

/** POST /api/v1/devices/authorize — libera um MAC direto na UniFi (sem portal). */
export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req, "write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const d = parsed.data;
  const mac = d.mac.toLowerCase().replace(/-/g, ":");
  const result = await grantGuestAccess(
    {
      identity: { fullName: d.label ?? "", email: "", phone: "", cpf: "", documentType: null, document: null },
      mac,
      apMac: null,
      ssid: null,
      site: d.site ?? null,
      originalUrl: null,
      fingerprint: null,
      authMethod: "admin",
      adminGrant: { minutes: d.minutes },
    },
    await getSystemSettings(),
    dictionaries.en,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await audit(req, "guest.authorize", mac, { minutes: d.minutes, site: d.site }, `api:${auth.caller.name}`);
  return NextResponse.json({ ok: true, registrationId: result.id });
}
