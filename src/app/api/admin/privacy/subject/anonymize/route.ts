import { NextRequest, NextResponse } from "next/server";
import { anonymizeRegistrations, subjectWhere } from "@/lib/privacy";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

/**
 * LGPD art. 18, IV/VI: eliminação/anonimização a pedido do titular. Mantém o
 * registro de conexão (MAC, IP, data/hora) exigido pelo Marco Civil.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  const where = subjectWhere(body);
  if (!where) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  const count = await anonymizeRegistrations(where);
  await audit(req, "privacy.anonymize", null, { registrations: count });
  return NextResponse.json({ ok: true, anonymized: count });
}
