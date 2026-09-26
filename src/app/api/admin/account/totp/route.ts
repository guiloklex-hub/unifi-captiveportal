import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/admin/totp";
import { actorOf, audit } from "@/lib/admin/audit";
import { getSystemSettings } from "@/lib/settings";

export const runtime = "nodejs";

async function currentUser(req: NextRequest) {
  return prisma.adminUser.findUnique({ where: { username: actorOf(req) } });
}

/** Inicia a configuração: gera segredo (ainda não ativo) e QR code. */
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Crie um usuário antes de ativar o 2FA" }, { status: 400 });
  if (user.totpEnabled) return NextResponse.json({ error: "2FA já está ativo" }, { status: 409 });

  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { id: user.id }, data: { totpSecretEnc: encryptSecret(secret) } });
  const issuer = (await getSystemSettings()).brandName || "UniFi Portal";
  const url = otpauthUrl(secret, user.username, issuer);
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return NextResponse.json({ secret, otpauthUrl: url, qrSvg });
}

/** Confirma com um código do app e ativa o 2FA. */
export async function PUT(req: NextRequest) {
  const user = await currentUser(req);
  const code = String((await req.json().catch(() => ({})))?.code ?? "");
  if (!user?.totpSecretEnc) return NextResponse.json({ error: "Inicie a configuração do 2FA" }, { status: 400 });
  if (!verifyTotp(decryptSecret(user.totpSecretEnc), code)) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }
  await prisma.adminUser.update({ where: { id: user.id }, data: { totpEnabled: true } });
  await audit(req, "account.totp_enabled", user.username);
  return NextResponse.json({ ok: true });
}

/** Desativa o 2FA (exige um código válido). */
export async function DELETE(req: NextRequest) {
  const user = await currentUser(req);
  const code = String((await req.json().catch(() => ({})))?.code ?? "");
  if (!user?.totpEnabled || !user.totpSecretEnc) return NextResponse.json({ error: "2FA não está ativo" }, { status: 400 });
  if (!verifyTotp(decryptSecret(user.totpSecretEnc), code)) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }
  await prisma.adminUser.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEnc: null } });
  await audit(req, "account.totp_disabled", user.username);
  return NextResponse.json({ ok: true });
}
