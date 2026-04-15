import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeGuest } from "@/lib/unifi";
import { guestRegistrationSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = guestRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const minutes = parseInt(process.env.GUEST_DURATION_MIN ?? "480", 10);
  const downKbps = parseInt(process.env.GUEST_DOWN_KBPS ?? "0", 10) || undefined;
  const upKbps = parseInt(process.env.GUEST_UP_KBPS ?? "0", 10) || undefined;

  const userAgent = req.headers.get("user-agent") ?? undefined;
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;

  const created = await prisma.guestRegistration.create({
    data: {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      cpf: data.cpf,
      macAddress: data.mac.toLowerCase(),
      apMac: data.apMac ?? null,
      ssid: data.ssid ?? null,
      site: data.site ?? null,
      userAgent,
      ipAddress,
      durationMin: minutes,
      downKbps,
      upKbps,
    },
  });

  try {
    await authorizeGuest({
      mac: data.mac,
      minutes,
      downKbps,
      upKbps,
      apMac: data.apMac ?? null,
    });
  } catch (err) {
    // Compensação: remover registro órfão para evitar dados inconsistentes
    await prisma.guestRegistration.delete({ where: { id: created.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { error: `Não foi possível liberar o acesso: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: created.id,
    redirect: process.env.PORTAL_SUCCESS_URL ?? data.originalUrl ?? null,
  });
}
