import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { diagnoseUniFi } from "@/lib/unifi";
import { connectionInputSchema, draftConfig } from "@/lib/unifi/connectionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Testa a conexão. Sem corpo: testa a configuração em uso. Com corpo: testa o
 * rascunho do formulário (sem salvar), herdando segredos em branco.
 */
export async function POST(req: NextRequest) {
  const text = await req.text();
  if (!text.trim()) return NextResponse.json(await diagnoseUniFi());

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = connectionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  return NextResponse.json(await diagnoseUniFi(await draftConfig(parsed.data)));
}
