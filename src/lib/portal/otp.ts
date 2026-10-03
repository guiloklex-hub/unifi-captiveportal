import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "../prisma";

/**
 * Código de verificação (OTP) de 6 dígitos para confirmar e-mail ou celular.
 *
 * - O código nunca é gravado: só um HMAC dele (chave derivada do ADMIN_SECRET).
 * - Vale 10 minutos, com no máximo 5 tentativas.
 * - Reenvio só após 45 s (anti-spam / custo de SMS).
 */

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 45 * 1000;
/** Acessos provisórios (para ler o e-mail) por MAC a cada 24 h. */
export const OTP_MAX_PREAUTH_PER_DAY = 2;
/** Teto de códigos para o MESMO telefone/e-mail em 24h, independente do MAC. */
export const OTP_MAX_PER_DESTINATION_PER_DAY = 5;

export type OtpChannel = "email" | "sms";

function hmacKey(): Buffer {
  const secret = process.env.ADMIN_SECRET ?? "";
  return Buffer.from(hkdfSync("sha256", secret, "unifi-captive-portal", "otp-v1", 32));
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(challengeId: string, code: string): string {
  return createHmac("sha256", hmacKey()).update(`${challengeId}:${code}`).digest("hex");
}

export function maskDestination(channel: OtpChannel, dest: string): string {
  if (channel === "email") {
    const [user, domain] = dest.split("@");
    return `${(user ?? "").slice(0, 2)}•••@${domain ?? ""}`;
  }
  const digits = dest.replace(/\D+/g, "");
  return `•••• ${digits.slice(-4)}`;
}

/**
 * Intervalo mínimo entre envios, por MAC E por destino. Why: o MAC vem do
 * cliente; só por MAC, trocar o MAC a cada pedido disparava códigos sem
 * limite para o telefone/e-mail de uma vítima (custo de SMS).
 */
export async function secondsUntilResend(mac: string, destination: string): Promise<number> {
  const last = await prisma.otpChallenge.findFirst({
    where: { OR: [{ mac }, { destination }] },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!last) return 0;
  const wait = last.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS - Date.now();
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

export async function destinationQuotaExceeded(destination: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.otpChallenge.count({ where: { destination, createdAt: { gte: since } } });
  return count >= OTP_MAX_PER_DESTINATION_PER_DAY;
}

export async function preAuthAllowed(mac: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.otpChallenge.count({ where: { mac, preAuth: true, createdAt: { gte: since } } });
  return count < OTP_MAX_PREAUTH_PER_DAY;
}

export type OtpVerifyResult<T> =
  | { ok: true; payload: T; channel: OtpChannel }
  | { ok: false; reason: "not_found" | "expired" | "too_many_attempts" | "invalid_code" };

/**
 * Confere o código. Incrementa tentativas a cada chamada e só aceita o desafio
 * do mesmo MAC que o iniciou.
 */
export async function verifyOtp<T>(challengeId: string, code: string, mac: string): Promise<OtpVerifyResult<T>> {
  const ch = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!ch || ch.mac !== mac.toLowerCase() || ch.verifiedAt) return { ok: false, reason: "not_found" };
  if (ch.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (ch.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  await prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });

  const expected = Buffer.from(ch.codeHash, "hex");
  const got = Buffer.from(hashOtp(ch.id, code.replace(/\D+/g, "")), "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: ch.attempts + 1 >= OTP_MAX_ATTEMPTS ? "too_many_attempts" : "invalid_code" };
  }

  // Marca como usado de forma atômica (evita duas autorizações com o mesmo código).
  const marked = await prisma.otpChallenge.updateMany({
    where: { id: ch.id, verifiedAt: null },
    data: { verifiedAt: new Date() },
  });
  if (marked.count === 0) return { ok: false, reason: "not_found" };
  return { ok: true, payload: JSON.parse(ch.payload) as T, channel: ch.channel as OtpChannel };
}
