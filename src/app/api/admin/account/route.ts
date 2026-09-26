import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACTOR_HEADER, ROLE_HEADER } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dados da conta logada. `legacy` = login por ADMIN_PASSWORD (sem usuário cadastrado). */
export async function GET(req: NextRequest) {
  const username = req.headers.get(ACTOR_HEADER) ?? "";
  const role = req.headers.get(ROLE_HEADER) ?? "viewer";
  const user = await prisma.adminUser.findUnique({
    where: { username },
    select: { username: true, name: true, role: true, totpEnabled: true, lastLoginAt: true },
  });
  const usersExist = (await prisma.adminUser.count()) > 0;
  return NextResponse.json({ user, legacy: !user, role, usersExist });
}
