import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createTokenSchema } from "@/lib/tokenValidators";
import { generateUniqueTokenCode, deriveStatus } from "@/lib/tokens";
import { applyLocksToCreateInput, getTokenLocks } from "@/lib/tokenLocks";
import { requireApiKey } from "@/lib/integrations/apiKeys";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

/**
 * POST /api/v1/vouchers — cria tokens de acesso (ex.: PMS do hotel gera o
 * voucher no check-in). Mesmo corpo de /api/admin/tokens, incluindo `quantity`.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req, "write");
  if ("response" in auth) return auth.response;

  const parsed = createTokenSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const locked = applyLocksToCreateInput(parsed.data, getTokenLocks());
  const batchId = parsed.data.quantity > 1 ? randomUUID() : null;
  const tokens = [];
  for (let i = 0; i < parsed.data.quantity; i++) {
    tokens.push(
      await prisma.accessToken.create({
        data: {
          code: await generateUniqueTokenCode(),
          description: locked.description || null,
          durationMin: locked.durationMin,
          downKbps: locked.downKbps ?? null,
          upKbps: locked.upKbps ?? null,
          bytesQuotaMB: locked.bytesQuotaMB ?? null,
          maxUses: locked.maxUses,
          expiresAt: locked.expiresAt,
          site: parsed.data.site?.trim() || "default",
          batchId,
        },
      }),
    );
  }
  await audit(req, "token.create", batchId ? `lote ${batchId}` : tokens[0].code, { quantity: tokens.length }, `api:${auth.caller.name}`);
  return NextResponse.json(
    {
      batchId,
      data: tokens.map((t) => ({
        id: t.id,
        code: t.code,
        durationMin: t.durationMin,
        maxUses: t.maxUses,
        expiresAt: t.expiresAt.toISOString(),
        site: t.site,
        status: deriveStatus(t),
      })),
    },
    { status: 201 },
  );
}
