import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/admin/password";
import { createUserSchema, publicUserSelect } from "@/lib/admin/users";
import { audit } from "@/lib/admin/audit";
import { invalidateAdminSessions } from "@/lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const users = await prisma.adminUser.findMany({ select: publicUserSelect, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const parsed = createUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const { username, name, role, password } = parsed.data;
  if (await prisma.adminUser.findUnique({ where: { username } })) {
    return NextResponse.json({ error: "Usuário já existe" }, { status: 409 });
  }
  const isFirst = (await prisma.adminUser.count()) === 0;
  // O primeiro usuário encerra o modo legado (ADMIN_PASSWORD): precisa ser admin.
  if (isFirst && role !== "admin") {
    return NextResponse.json({ error: "O primeiro usuário precisa ser administrador" }, { status: 400 });
  }
  const user = await prisma.adminUser.create({
    data: { username, name: name || null, role, passwordHash: await hashPassword(password) },
    select: publicUserSelect,
  });
  if (isFirst) invalidateAdminSessions();
  await audit(req, "user.create", username, { role });
  return NextResponse.json({ user, legacyDisabled: isFirst }, { status: 201 });
}
