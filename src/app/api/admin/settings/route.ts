import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTokenLocks } from "@/lib/tokenLocks";
import { settingsSchema } from "@/lib/settingsValidators";
import { getSystemSettings, invalidateSystemSettingsCache } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Valor efetivo: locks de `.env` (ex.: TOKEN_LOCK_REQUIRE) já aplicados.
  return NextResponse.json(await getSystemSettings());
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const locks = getTokenLocks();
  const requireTokenFinal =
    locks.requireToken !== undefined ? locks.requireToken : Boolean(data.requireToken);

  // URLs vazias após validação ⇒ persistir null para limpar o campo.
  const logoUrl = data.logoUrl === "" ? null : data.logoUrl;
  const backgroundUrl = data.backgroundUrl === "" ? null : data.backgroundUrl;

  const singleDeviceByCpf = Boolean(data.singleDeviceByCpf);

  const settings = await prisma.systemSettings.upsert({
    where: { id: "config" },
    update: {
      brandName: data.brandName,
      logoUrl,
      backgroundUrl,
      primaryColor: data.primaryColor,
      termsOfUse: data.termsOfUse,
      requireToken: requireTokenFinal,
      singleDeviceByCpf,
    },
    create: {
      id: "config",
      brandName: data.brandName,
      logoUrl,
      backgroundUrl,
      primaryColor: data.primaryColor,
      termsOfUse: data.termsOfUse,
      requireToken: requireTokenFinal,
      singleDeviceByCpf,
    },
  });
  invalidateSystemSettingsCache();

  return NextResponse.json(settings);
}
