import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSystemSettings } from "@/lib/settings";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { grantGuestAccess } from "@/lib/portal/grantAccess";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

const schema = z.object({
  mac: z.string().trim().regex(/^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i, "MAC inválido"),
  site: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().nullable(),
  minutes: z.coerce.number().int().min(1).max(525_600),
  label: z.string().trim().max(120).optional().nullable(),
});

/**
 * "Liberar dispositivo agora": autoriza um MAC direto na UniFi, sem portal —
 * para TVs, impressoras, consoles e outros aparelhos sem navegador.
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
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
    dictionaries.pt,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await audit(req, "guest.authorize", mac, { minutes: d.minutes, site: d.site, label: d.label });
  return NextResponse.json({ ok: true, id: result.id });
}
