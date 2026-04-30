import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTokenSchema } from "@/lib/tokenValidators";
import { generateUniqueTokenCode, deriveStatus, type TokenStatus } from "@/lib/tokens";
import { applyLocksToCreateInput, getTokenLocks } from "@/lib/tokenLocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") as TokenStatus | null;
  const q = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10)));

  const where: Prisma.AccessTokenWhereInput = {};
  if (q) {
    where.OR = [
      { code: { contains: q.toUpperCase() } },
      { description: { contains: q } },
    ];
  }

  // Filtro por status: aplica condições derivadas no SQL quando possível.
  const now = new Date();
  if (status === "revoked") {
    where.revokedAt = { not: null };
  } else if (status === "expired") {
    where.AND = [{ revokedAt: null }, { expiresAt: { lte: now } }];
  } else if (status === "active") {
    // ativo: não revogado E não expirado E ainda há usos.
    // SQLite não suporta column-vs-column para usedCount<maxUses; filtramos em memória.
    where.AND = [{ revokedAt: null }, { expiresAt: { gt: now } }];
  } else if (status === "exhausted") {
    where.AND = [{ revokedAt: null }, { expiresAt: { gt: now } }];
  }

  const [total, rows] = await Promise.all([
    prisma.accessToken.count({ where }),
    prisma.accessToken.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  let filtered = rows;
  if (status === "active") {
    filtered = rows.filter((t) => t.usedCount < t.maxUses);
  } else if (status === "exhausted") {
    filtered = rows.filter((t) => t.usedCount >= t.maxUses);
  }

  return NextResponse.json({
    total,
    rows: filtered.map((t) => ({
      ...t,
      status: deriveStatus(t),
    })),
    page,
    pageSize,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = createTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const locked = applyLocksToCreateInput(parsed.data, getTokenLocks());
  const code = await generateUniqueTokenCode();

  const token = await prisma.accessToken.create({
    data: {
      code,
      description: locked.description || null,
      durationMin: locked.durationMin,
      downKbps: locked.downKbps ?? null,
      upKbps: locked.upKbps ?? null,
      bytesQuotaMB: locked.bytesQuotaMB ?? null,
      maxUses: locked.maxUses,
      expiresAt: locked.expiresAt,
      site: parsed.data.site && parsed.data.site.trim() ? parsed.data.site.trim() : "default",
    },
  });

  return NextResponse.json({ ...token, status: deriveStatus(token) }, { status: 201 });
}
