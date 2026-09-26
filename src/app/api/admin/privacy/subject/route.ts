import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { subjectWhere } from "@/lib/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resumo dos dados de um titular (CPF, e-mail, documento ou telefone exatos). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const where = subjectWhere({
    cpf: sp.get("cpf") ?? undefined,
    email: sp.get("email") ?? undefined,
    document: sp.get("document") ?? undefined,
    phone: sp.get("phone") ?? undefined,
  });
  if (!where) return NextResponse.json({ error: "Informe um CPF, e-mail, documento ou telefone completo" }, { status: 400 });

  const [count, first, last, anonymized, marketing] = await Promise.all([
    prisma.guestRegistration.count({ where }),
    prisma.guestRegistration.findFirst({ where, orderBy: { authorizedAt: "asc" }, select: { authorizedAt: true } }),
    prisma.guestRegistration.findFirst({
      where,
      orderBy: { authorizedAt: "desc" },
      select: { authorizedAt: true, fullName: true },
    }),
    prisma.guestRegistration.count({ where: { AND: [where, { anonymizedAt: { not: null } }] } }),
    prisma.guestRegistration.count({ where: { AND: [where, { marketingConsent: true }] } }),
  ]);
  return NextResponse.json({
    count,
    anonymized,
    marketingConsents: marketing,
    firstAt: first?.authorizedAt ?? null,
    lastAt: last?.authorizedAt ?? null,
    name: last?.fullName ?? null,
  });
}
