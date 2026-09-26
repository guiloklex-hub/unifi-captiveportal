import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { clientIp } from "@/lib/rateLimit";
import { getSystemSettings } from "@/lib/settings";
import { authorizeGuest } from "@/lib/unifi";
import { validateTokenForUse } from "@/lib/tokens";
import { portalRateLimit } from "@/lib/portal/rateLimit";
import { parseGuestForm } from "@/lib/portal/form";
import {
  OTP_TTL_MS,
  generateOtpCode,
  hashOtp,
  maskDestination,
  preAuthAllowed,
  secondsUntilResend,
  type OtpChannel,
} from "@/lib/portal/otp";
import { sendEmail } from "@/lib/messaging/email";
import { sendSms } from "@/lib/messaging/sms";

export const runtime = "nodejs";

/** Acesso provisório (e-mail): banda baixa, só para ler o código. */
const PREAUTH_DOWN_KBPS = 2048;
const PREAUTH_UP_KBPS = 512;

/**
 * Valida o formulário e envia o código de verificação. Com e-mail, libera um
 * acesso provisório curto para o guest conseguir abrir a caixa de entrada.
 */
export async function POST(req: NextRequest) {
  const dict = dictionaries[getLocale(req.headers.get("accept-language"))];
  const settings = await getSystemSettings();
  const channel = settings.verificationMode as OtpChannel | "none";
  if (channel === "none") return NextResponse.json({ error: dict.portal.errInvalidData }, { status: 400 });

  const body = await req.json().catch(() => null);
  const ip = clientIp(req.headers);
  const limited = portalRateLimit("otp-start", ip, body, dict, 5);
  if (limited) return limited;

  const form = parseGuestForm(body, settings, dict);
  if (!form.ok) return NextResponse.json(form.body, { status: form.status });
  const data = form.data;
  const mac = data.mac.toLowerCase();

  const destination = channel === "email" ? data.email : data.phone;
  if (!destination) {
    const field = channel === "email" ? "email" : "phone";
    const message = channel === "email" ? dict.validation.valEmailInvalid : dict.validation.valPhoneInvalid;
    return NextResponse.json({ error: message, issues: { fieldErrors: { [field]: [message] } } }, { status: 400 });
  }

  // Falha cedo com token inválido (o uso só é consumido na verificação).
  if (settings.requireToken) {
    try {
      await validateTokenForUse(data.token ?? "");
    } catch {
      return NextResponse.json({ error: dict.validation.valTokenInvalid }, { status: 400 });
    }
  }

  const wait = await secondsUntilResend(mac);
  if (wait > 0) {
    return NextResponse.json(
      { error: dict.portal.otpWait.replace("{s}", String(wait)), retryAfter: wait },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  const code = generateOtpCode();
  const challenge = await prisma.otpChallenge.create({
    data: {
      mac,
      channel,
      destination,
      codeHash: "pending",
      payload: JSON.stringify(data),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { codeHash: hashOtp(challenge.id, code) } });

  const log = logger.child({ mac, channel, challengeId: challenge.id });
  try {
    if (channel === "email") {
      const subject = dict.portal.otpEmailSubject;
      const text = dict.portal.otpMessage.replace("{code}", code);
      await sendEmail(destination, subject, text, `<p style="font-size:16px">${text}</p>`);
    } else {
      await sendSms(destination, dict.portal.otpMessage.replace("{code}", code));
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, "OTP send failed");
    await prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    return NextResponse.json({ error: dict.portal.errOtpSendFailed }, { status: 502 });
  }

  // Acesso provisório para ler o e-mail (limitado por MAC/dia).
  let preAuthMinutes = 0;
  if (channel === "email" && settings.otpPreAuthMinutes > 0 && (await preAuthAllowed(mac))) {
    try {
      await authorizeGuest({
        mac,
        minutes: settings.otpPreAuthMinutes,
        downKbps: PREAUTH_DOWN_KBPS,
        upKbps: PREAUTH_UP_KBPS,
        apMac: data.apMac,
        site: data.site,
      });
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { preAuth: true } });
      preAuthMinutes = settings.otpPreAuthMinutes;
    } catch (err) {
      // O guest ainda pode ler o e-mail pelo 4G; segue sem acesso provisório.
      log.warn({ err: (err as Error).message }, "OTP pre-auth failed");
    }
  }

  log.info({ preAuthMinutes }, "OTP sent");
  return NextResponse.json({
    challengeId: challenge.id,
    channel,
    destination: maskDestination(channel, destination),
    preAuthMinutes,
  });
}
