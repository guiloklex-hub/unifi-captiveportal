import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Endpoint público (lado do guest) — devolve apenas dados não-sensíveis
 * sobre a sessão que acabou de ser criada para a tela de sucesso. NÃO
 * vaza CPF, telefone, email ou outros PII. Limite de validade: 5 min.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  const reg = await prisma.guestRegistration.findUnique({
    where: { id: numId },
    select: {
      authorizedAt: true,
      durationMin: true,
      downKbps: true,
      upKbps: true,
      bytesQuotaMB: true,
      ssid: true,
      site: true,
    },
  });
  if (!reg) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }
  // Janela de 5 min após autorização — depois disso o endpoint não responde
  // mais (defesa contra varredura).
  const ageMs = Date.now() - reg.authorizedAt.getTime();
  if (ageMs > 5 * 60_000) {
    return NextResponse.json({ error: "Sessão expirada para consulta" }, { status: 410 });
  }
  const expiresAt = new Date(reg.authorizedAt.getTime() + reg.durationMin * 60_000);
  return NextResponse.json({
    authorizedAt: reg.authorizedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMin: reg.durationMin,
    downKbps: reg.downKbps,
    upKbps: reg.upKbps,
    bytesQuotaMB: reg.bytesQuotaMB,
    ssid: reg.ssid,
    site: reg.site,
  });
}
