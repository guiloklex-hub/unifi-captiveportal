import { NextRequest, NextResponse } from "next/server";
import { exportSubject, subjectWhere } from "@/lib/privacy";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LGPD art. 18, II/V: acesso e portabilidade — JSON com todos os registros do titular. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const where = subjectWhere({
    cpf: sp.get("cpf") ?? undefined,
    email: sp.get("email") ?? undefined,
    document: sp.get("document") ?? undefined,
    phone: sp.get("phone") ?? undefined,
  });
  if (!where) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });

  const data = await exportSubject(where);
  await audit(req, "privacy.export", null, { registrations: data.registrations.length });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dados-titular-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
