import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/integrations/apiKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/registrations?since=ISO&until=ISO&site=&limit=100&cursor=<id>
 * Escopo `read` (sem dados pessoais) ou `read:pii` (com nome, e-mail, telefone, documento).
 * Paginação por cursor: use `nextCursor` da resposta.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req, "read");
  if ("response" in auth) return auth.response;
  const withPii = auth.caller.scopes.includes("read:pii");

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(500, Math.max(1, parseInt(sp.get("limit") ?? "100", 10) || 100));
  const where: Prisma.GuestRegistrationWhereInput = {};
  const since = sp.get("since");
  const until = sp.get("until");
  if (since || until) {
    where.authorizedAt = {};
    if (since && !Number.isNaN(Date.parse(since))) where.authorizedAt.gte = new Date(since);
    if (until && !Number.isNaN(Date.parse(until))) where.authorizedAt.lt = new Date(until);
  }
  const site = sp.get("site");
  if (site) where.site = site;
  const cursor = parseInt(sp.get("cursor") ?? "", 10);

  const rows = await prisma.guestRegistration.findMany({
    where,
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(Number.isFinite(cursor) ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { token: { select: { code: true } } },
  });
  const page = rows.slice(0, limit);

  return NextResponse.json({
    data: page.map((r) => ({
      id: r.id,
      authorizedAt: r.authorizedAt.toISOString(),
      mac: r.macAddress,
      ip: r.ipAddress,
      site: r.site,
      ssid: r.ssid,
      apMac: r.apMac,
      authMethod: r.authMethod,
      durationMin: r.durationMin,
      bytesTx: r.bytesTx?.toString() ?? null,
      bytesRx: r.bytesRx?.toString() ?? null,
      token: r.token?.code ?? null,
      marketingConsent: r.marketingConsent,
      anonymized: Boolean(r.anonymizedAt),
      ...(withPii
        ? {
            fullName: r.fullName,
            email: r.email,
            phone: r.phone,
            cpf: r.cpf,
            documentType: r.documentType,
            document: r.document,
          }
        : {}),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
}
