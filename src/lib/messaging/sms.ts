import { fetch } from "undici";
import { logger } from "../logger";

/**
 * Envio de SMS. Provedores:
 *
 *   SMS_PROVIDER=twilio   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (+5511...)
 *   SMS_PROVIDER=webhook  SMS_WEBHOOK_URL (+ SMS_WEBHOOK_TOKEN opcional, enviado como Bearer)
 *                         → POST JSON { "to": "+5511999999999", "message": "..." }
 *
 * O modo webhook permite plugar qualquer gateway (Zenvia, Infobip, AWS SNS,
 * WhatsApp Business via n8n/Make…) sem alterar o código.
 */

export function smsConfigured(): boolean {
  const provider = process.env.SMS_PROVIDER;
  if (provider === "twilio") {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  }
  if (provider === "webhook") return Boolean(process.env.SMS_WEBHOOK_URL);
  return false;
}

/** Converte o telefone salvo (11 dígitos BR ou "+<dígitos>") para E.164. */
export function toE164(phone: string): string {
  if (phone.startsWith("+")) return phone;
  const digits = phone.replace(/\D+/g, "");
  return digits.length === 11 ? `+55${digits}` : `+${digits}`;
}

export async function sendSms(phone: string, message: string): Promise<void> {
  const to = toE164(phone);
  const provider = process.env.SMS_PROVIDER;
  const signal = AbortSignal.timeout(10_000);

  if (provider === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: message }).toString(),
      signal,
    });
    if (!res.ok) throw new Error(`Twilio respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } else if (provider === "webhook") {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.SMS_WEBHOOK_TOKEN) headers.authorization = `Bearer ${process.env.SMS_WEBHOOK_TOKEN}`;
    const res = await fetch(process.env.SMS_WEBHOOK_URL!, {
      method: "POST",
      headers,
      body: JSON.stringify({ to, message }),
      signal,
    });
    if (!res.ok) throw new Error(`Webhook de SMS respondeu ${res.status}`);
  } else {
    throw new Error("SMS não configurado (SMS_PROVIDER)");
  }
  logger.info({ provider }, "sms sent");
}
