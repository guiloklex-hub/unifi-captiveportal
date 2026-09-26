import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { API_SCOPES, generateApiKey } from "@/lib/integrations/apiKeys";
import { actorOf, audit } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

const select = { id: true, name: true, prefix: true, scopes: true, createdBy: true, createdAt: true, lastUsedAt: true, revokedAt: true } as const;

export async function GET() {
  return NextResponse.json({ keys: await prisma.apiKey.findMany({ select, orderBy: { createdAt: "desc" } }) });
}

/** Cria a chave e devolve o valor completo UMA única vez (só o hash é guardado). */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const { key, prefix, hash } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: { name: parsed.data.name, prefix, hash, scopes: parsed.data.scopes.join(","), createdBy: actorOf(req) },
    select,
  });
  await audit(req, "apikey.create", `${parsed.data.name} (${prefix})`, { scopes: parsed.data.scopes });
  return NextResponse.json({ key: created, secret: key }, { status: 201 });
}
