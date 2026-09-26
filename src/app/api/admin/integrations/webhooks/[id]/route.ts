import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Informe enabled" }, { status: 400 });
  const hook = await prisma.webhook.update({ where: { id }, data: { enabled: body.enabled } }).catch(() => null);
  if (!hook) return NextResponse.json({ error: "Webhook não encontrado" }, { status: 404 });
  await audit(req, body.enabled ? "webhook.enable" : "webhook.disable", hook.url);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const hook = await prisma.webhook.delete({ where: { id } }).catch(() => null);
  if (!hook) return NextResponse.json({ error: "Webhook não encontrado" }, { status: 404 });
  await audit(req, "webhook.delete", hook.url);
  return NextResponse.json({ ok: true });
}
