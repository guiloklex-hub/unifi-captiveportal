import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "../logger";

/**
 * Envio de e-mail via SMTP (qualquer provedor: Gmail/Workspace, Microsoft 365,
 * SES, SendGrid, Mailgun, servidor próprio…).
 *
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE ("true" para 465),
 *   SMTP_USER, SMTP_PASSWORD, SMTP_FROM ("Wi-Fi Hotel <wifi@hotel.com>")
 */

const g = globalThis as unknown as { __smtpTransport?: Transporter };

export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function transport(): Transporter {
  if (!g.__smtpTransport) {
    g.__smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return g.__smtpTransport;
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!emailConfigured()) throw new Error("SMTP não configurado (SMTP_HOST/SMTP_FROM)");
  const info = await transport().sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
  logger.info({ messageId: info.messageId }, "email sent");
}
