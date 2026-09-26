import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/admin/password";
import { passwordSchema } from "@/lib/admin/users";
import { actorOf, audit } from "@/lib/admin/audit";
import { invalidateAdminSessions } from "@/lib/admin/session";

export const runtime = "nodejs";

const schema = z.object({ currentPassword: z.string(), newPassword: passwordSchema });

/** Troca da própria senha. Derruba as outras sessões abertas. */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const user = await prisma.adminUser.findUnique({ where: { username: actorOf(req) } });
  if (!user) return NextResponse.json({ error: "Crie um usuário antes de definir senha" }, { status: 400 });
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
  }
  await prisma.adminUser.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword), sessionVersion: { increment: 1 } },
  });
  invalidateAdminSessions();
  await audit(req, "account.password_change", user.username);
  return NextResponse.json({ ok: true, reloginRequired: true });
}
