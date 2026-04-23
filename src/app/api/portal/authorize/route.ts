import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeGuest, UniFiUnavailableError } from "@/lib/unifi";
import { getGuestRegistrationSchema } from "@/lib/validators";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { logger } from "@/lib/logger";
import { rateLimit, clientIp } from "@/lib/rateLimit";

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
  const schema = getGuestRegistrationSchema(dict.validation);

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
  const minutes = parseInt(process.env.GUEST_DURATION_MIN ?? "480", 10);
  const downKbps = parseInt(process.env.GUEST_DOWN_KBPS ?? "0", 10) || undefined;
  const upKbps = parseInt(process.env.GUEST_UP_KBPS ?? "0", 10) || undefined;

  const userAgent = req.headers.get("user-agent") ?? undefined;
  const ipAddress = ip !== "unknown" ? ip : undefined;

  const mac = data.mac.toLowerCase();
  const log = logger.child({ mac, ssid: data.ssid, ip: ipAddress });

  // 1) Autoriza na UniFi PRIMEIRO. Se falhar, nada é persistido — o log do admin
  //    reflete apenas acessos efetivamente liberados.
  try {
    await authorizeGuest({
      mac,
      minutes,
      downKbps,
      upKbps,
      apMac: data.apMac ?? null,
    });
  } catch (err) {
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

  // 2) Gravação/atualização idempotente por (mac, dia) após autorização bem-sucedida.
  const authDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

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
        site: data.site ?? null,
        userAgent,
        ipAddress,
        durationMin: minutes,
        downKbps,
        upKbps,
      },
      update: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        cpf: data.cpf,
        apMac: data.apMac ?? null,
        ssid: data.ssid ?? null,
        site: data.site ?? null,
        userAgent,
        ipAddress,
        durationMin: minutes,
        downKbps,
        upKbps,
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

  log.info({ id: createdId }, "Guest authorized");

  return NextResponse.json({
    ok: true,
    id: createdId,
    redirect: sanitizeRedirect(process.env.PORTAL_SUCCESS_URL ?? data.originalUrl),
  });
}
