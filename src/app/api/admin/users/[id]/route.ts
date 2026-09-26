import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/admin/password";
import { activeAdminsExcluding, publicUserSelect, updateUserSchema } from "@/lib/admin/users";
import { actorOf, audit } from "@/lib/admin/audit";
import { invalidateAdminSessions } from "@/lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const user = await prisma.adminUser.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const d = parsed.data;

  const losesAdmin = (d.role !== undefined && d.role !== "admin") || d.disabled === true;
  if (user.role === "admin" && !user.disabled && losesAdmin && (await activeAdminsExcluding(id)) === 0) {
    return NextResponse.json({ error: "Deve existir pelo menos um administrador ativo" }, { status: 400 });
  }
  if (d.disabled === true && user.username === actorOf(req)) {
    return NextResponse.json({ error: "Você não pode desativar a própria conta" }, { status: 400 });
  }

  // Mudanças de segurança derrubam as sessões abertas do usuário.
  const bumpSession = d.password !== undefined || d.disabled === true || d.role !== undefined || d.resetTotp === true;
  const updated = await prisma.adminUser.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name || null } : {}),
      ...(d.role !== undefined ? { role: d.role } : {}),
      ...(d.disabled !== undefined ? { disabled: d.disabled } : {}),
      ...(d.password !== undefined ? { passwordHash: await hashPassword(d.password) } : {}),
      ...(d.resetTotp ? { totpEnabled: false, totpSecretEnc: null } : {}),
      ...(d.unlock ? { lockedUntil: null, failedLogins: 0 } : {}),
      ...(bumpSession ? { sessionVersion: { increment: 1 } } : {}),
    },
    select: publicUserSelect,
  });
  if (bumpSession) invalidateAdminSessions();

  const changes = Object.keys(d).filter((k) => k !== "password");
  if (d.password !== undefined) changes.push("password(reset)");
  await audit(req, "user.update", user.username, { changes, role: d.role, disabled: d.disabled });
  return NextResponse.json({ user: updated });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await prisma.adminUser.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (user.username === actorOf(req)) {
    return NextResponse.json({ error: "Você não pode excluir a própria conta" }, { status: 400 });
  }
  if (user.role === "admin" && !user.disabled && (await activeAdminsExcluding(id)) === 0) {
    return NextResponse.json({ error: "Deve existir pelo menos um administrador ativo" }, { status: 400 });
  }
  await prisma.adminUser.delete({ where: { id } });
  invalidateAdminSessions();
  await audit(req, "user.delete", user.username);
  return NextResponse.json({ ok: true });
}
