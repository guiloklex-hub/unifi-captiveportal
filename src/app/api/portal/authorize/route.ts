import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeGuest, UniFiUnavailableError } from "@/lib/unifi";
import { getGuestRegistrationSchema } from "@/lib/validators";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { logger } from "@/lib/logger";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { getSystemSettings } from "@/lib/settings";
import {
  validateTokenForUse,
  reserveTokenUse,
  releaseTokenUse,
  TokenInvalidError,
  TokenExpiredError,
  TokenRevokedError,
  TokenExhaustedError,
  TokenUnavailableError,
} from "@/lib/tokens";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Remove querystrings potencialmente sensíveis da URL original (tokens, códigos).
 * Mantém apenas scheme+host+path.
 */
function sanitizeRedirect(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const locale = getLocale(req.headers.get("accept-language"));
  const dict = dictionaries[locale];
  const settings = await getSystemSettings();
  const schema = getGuestRegistrationSchema(dict.validation, {
    requireToken: settings.requireToken,
  });

  const ip = clientIp(req.headers);
  const rl = rateLimit(`authorize:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    logger.warn({ ip, resetAt: rl.resetAt }, "authorize rate-limited");
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde alguns segundos e tente novamente." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  let minutes = parseInt(process.env.GUEST_DURATION_MIN ?? "480", 10);
  let downKbps: number | undefined =
    parseInt(process.env.GUEST_DOWN_KBPS ?? "0", 10) || undefined;
  let upKbps: number | undefined =
    parseInt(process.env.GUEST_UP_KBPS ?? "0", 10) || undefined;
  let bytesQuotaMB: number | undefined;
  let unifiSite: string | null = data.site ?? null;

  const userAgent = req.headers.get("user-agent") ?? undefined;
  const ipAddress = ip !== "unknown" ? ip : undefined;
  const fingerprint = data.fingerprint ?? undefined;

  const mac = data.mac.toLowerCase();
  const authDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const log = logger.child({ mac, ssid: data.ssid, ip: ipAddress });

  // Validação e reserva de token (apenas quando exigido pelo SystemSettings).
  let tokenId: string | null = null;
  let tokenReserved = false;
  if (settings.requireToken) {
    try {
      const token = await validateTokenForUse(data.token ?? "");
      tokenId = token.id;
      minutes = token.durationMin;
      downKbps = token.downKbps ?? undefined;
      upKbps = token.upKbps ?? undefined;
      bytesQuotaMB = token.bytesQuotaMB ?? undefined;
      // Token vinculado a site específico tem precedência sobre o site da URL UniFi.
      if (token.site && token.site.trim()) unifiSite = token.site;

      // Sinal de possível reuso fraudulento: mesmo MAC com fingerprint
      // diferente de uso anterior do mesmo token. Apenas registra em log.
      if (fingerprint) {
        const priorWithDiffFp = await prisma.guestRegistration.findFirst({
          where: {
            tokenId: token.id,
            macAddress: mac,
            AND: [
              { fingerprint: { not: null } },
              { fingerprint: { not: fingerprint } },
            ],
          },
          select: { id: true },
        });
        if (priorWithDiffFp) {
          log.warn(
            { tokenId: token.id },
            "Fingerprint mismatch on same MAC+token — possible MAC spoofing",
          );
        }
      }

      // Idempotência: se este mesmo MAC já consumiu este token hoje (refresh
      // do navegador, retentativa após queda de rede, etc.), não incrementa
      // usedCount de novo — apenas re-autoriza na UniFi com os mesmos limites.
      const existing = await prisma.guestRegistration.findUnique({
        where: { macAddress_authDate: { macAddress: mac, authDate } },
        select: { tokenId: true },
      });
      const alreadyConsumed = existing?.tokenId === token.id;

      if (!alreadyConsumed) {
        await reserveTokenUse(token.id);
        tokenReserved = true;
        // Marca primeiro uso (idempotente: só seta se ainda for null).
        await prisma.accessToken.updateMany({
          where: { id: token.id, firstUsedAt: null },
          data: { firstUsedAt: new Date() },
        }).catch(() => undefined);
      } else {
        log.info({ tokenId: token.id }, "Token reuse by same MAC/day — skipping reserve");
      }
    } catch (err) {
      const map = new Map<string, string>([
        [TokenInvalidError.name, dict.validation.valTokenInvalid],
        [TokenExpiredError.name, dict.validation.valTokenExpired],
        [TokenRevokedError.name, dict.validation.valTokenRevoked],
        [TokenExhaustedError.name, dict.validation.valTokenExhausted],
        [TokenUnavailableError.name, dict.validation.valTokenExhausted],
      ]);
      if (err instanceof Error && map.has(err.name)) {
        log.info({ tokenError: err.name }, "Token validation failed");
        return NextResponse.json({ error: map.get(err.name) }, { status: 400 });
      }
      throw err;
    }
  }

  // Autoriza na UniFi. Se falhar e havia token reservado, libera o uso.
  try {
    await authorizeGuest({
      mac,
      minutes,
      downKbps,
      upKbps,
      bytesQuotaMB,
      apMac: data.apMac ?? null,
      site: unifiSite,
    });
  } catch (err) {
    if (tokenReserved && tokenId) {
      await releaseTokenUse(tokenId).catch((e) =>
        log.error({ err: (e as Error).message }, "Failed to release token use after UniFi failure"),
      );
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    const isDown = err instanceof UniFiUnavailableError;
    log.error({ err: message, isDown }, "UniFi authorize failed");
    return NextResponse.json(
      {
        error: isDown
          ? "Serviço temporariamente indisponível. Tente novamente em alguns instantes."
          : `Não foi possível liberar o acesso: ${message}`,
      },
      { status: 502 },
    );
  }

  // Gravação/atualização idempotente por (mac, dia) após autorização bem-sucedida.
  let createdId: number | null = null;
  try {
    const record = await prisma.guestRegistration.upsert({
      where: { macAddress_authDate: { macAddress: mac, authDate } },
      create: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        cpf: data.cpf,
        macAddress: mac,
        authDate,
        apMac: data.apMac ?? null,
        ssid: data.ssid ?? null,
        site: unifiSite,
        userAgent,
        ipAddress,
        fingerprint,
        durationMin: minutes,
        downKbps,
        upKbps,
        bytesQuotaMB,
        tokenId,
      },
      update: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        cpf: data.cpf,
        apMac: data.apMac ?? null,
        ssid: data.ssid ?? null,
        site: unifiSite,
        userAgent,
        ipAddress,
        fingerprint,
        durationMin: minutes,
        downKbps,
        upKbps,
        bytesQuotaMB,
        tokenId,
        authorizedAt: new Date(),
      },
    });
    createdId = record.id;
  } catch (err) {
    // Autorizou na UniFi mas falhou no banco: não é bloqueante para o guest,
    // mas registramos para reconciliação posterior.
    log.error({ err: (err as Error).message }, "DB persist failed after UniFi authorize");
    return NextResponse.json({
      ok: true,
      id: null,
      redirect: sanitizeRedirect(process.env.PORTAL_SUCCESS_URL ?? data.originalUrl),
    });
  }

  log.info({ id: createdId, tokenId }, "Guest authorized");

  return NextResponse.json({
    ok: true,
    id: createdId,
    redirect: sanitizeRedirect(process.env.PORTAL_SUCCESS_URL ?? data.originalUrl),
  });
}
