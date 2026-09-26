import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/admin/audit";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTokenLocks } from "@/lib/tokenLocks";
import { settingsSchema } from "@/lib/settingsValidators";
import { getSystemSettings, invalidateSystemSettingsCache } from "@/lib/settings";
import { emailConfigured } from "@/lib/messaging/email";
import { smsConfigured } from "@/lib/messaging/sms";
import { redirectUri } from "@/lib/portal/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Valor efetivo: locks de `.env` (ex.: TOKEN_LOCK_REQUIRE) já aplicados.
  // `capabilities` informa ao painel quais integrações têm credenciais no .env.
  return NextResponse.json({
    ...(await getSystemSettings()),
    capabilities: {
      email: emailConfigured(),
      sms: smsConfigured(),
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
      oauthRedirectUri: redirectUri(),
    },
  });
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

  // Campos novos são opcionais no payload: ausente = mantém o valor atual.
  const optional = Object.fromEntries(
    (
      [
        "defaultDurationMin",
        "defaultDownKbps",
        "defaultUpKbps",
        "defaultQuotaMB",
        "fieldName",
        "fieldEmail",
        "fieldPhone",
        "fieldDocument",
        "allowForeignDocument",
        "rememberDeviceDays",
        "verificationMode",
        "otpPreAuthMinutes",
        "socialGoogle",
        "socialMicrosoft",
        "marketingConsentMode",
        "marketingConsentText",
        "reportFrequency",
        "reportRecipients",
      ] as const
    )
      .filter((k) => data[k] !== undefined)
      .map((k) => [k, data[k]]),
  );

  const fields = {
    brandName: data.brandName,
    logoUrl,
    backgroundUrl,
    primaryColor: data.primaryColor,
    termsOfUse: data.termsOfUse,
    requireToken: requireTokenFinal,
    singleDeviceByCpf,
    ...optional,
  };

  const settings = await prisma.systemSettings.upsert({
    where: { id: "config" },
    update: fields,
    create: { id: "config", ...fields },
  });
  invalidateSystemSettingsCache();
  await audit(req, "settings.update", null, { fields: Object.keys(fields) });

  return NextResponse.json(settings);
}
