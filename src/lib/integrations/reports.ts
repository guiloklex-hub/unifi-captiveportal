import { computeMetrics, type PortalMetrics } from "./metrics";
import { sendEmail, emailConfigured } from "../messaging/email";
import { formatBytes } from "../format";
import type { SystemSettings } from "../settings";

/**
 * Relatório periódico por e-mail (diário ou semanal). Disparado por cron em
 * POST /api/admin/reports/send com Bearer CRON_SECRET — o endpoint decide se
 * hoje é dia de envio (semanal = segunda-feira, horário de Brasília).
 */

const METHOD_LABEL: Record<string, string> = {
  form: "Formulário",
  token: "Token",
  returning: "Recorrente",
  "otp-email": "Código por e-mail",
  "otp-sms": "Código por SMS",
  google: "Google",
  microsoft: "Microsoft",
  allowlist: "Dispositivo liberado",
  admin: "Liberado pelo admin",
};

export function recipientsOf(settings: SystemSettings): string[] {
  return (settings.reportRecipients ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

export function isReportDay(frequency: SystemSettings["reportFrequency"], now = new Date()): boolean {
  if (frequency === "daily") return true;
  if (frequency !== "weekly") return false;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  return weekday === "Mon";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderReport(brand: string, periodLabel: string, m: PortalMetrics): { subject: string; text: string; html: string } {
  const lines: [string, string][] = [
    ["Conexões", m.connections.toLocaleString("pt-BR")],
    ["Visitantes únicos", m.uniqueVisitors.toLocaleString("pt-BR")],
    ["Novos visitantes", m.newVisitors.toLocaleString("pt-BR")],
    ["Consentimentos de marketing", m.marketingConsents.toLocaleString("pt-BR")],
    ["Tráfego", formatBytes(m.bytesTotal)],
  ];
  const methods = Object.entries(m.byMethod)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [METHOD_LABEL[k] ?? k, v.toLocaleString("pt-BR")] as [string, string]);
  const sites = Object.entries(m.bySite)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k, v.toLocaleString("pt-BR")] as [string, string]);

  const subject = `${brand} — relatório Wi-Fi (${periodLabel})`;
  const text = [
    subject,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    "",
    "Formas de acesso:",
    ...methods.map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Sites:",
    ...sites.map(([k, v]) => `  ${k}: ${v}`),
  ].join("\n");

  const table = (rows: [string, string][]) =>
    `<table style="border-collapse:collapse;margin:8px 0 16px">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#475569">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(v)}</td></tr>`,
      )
      .join("")}</table>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0f172a">
<h2 style="margin:0 0 4px">${escapeHtml(brand)}</h2>
<p style="margin:0 0 12px;color:#475569">Relatório do Wi-Fi — ${escapeHtml(periodLabel)}</p>
${table(lines)}
<h3 style="margin:0">Formas de acesso</h3>${table(methods.length ? methods : [["—", "0"]])}
<h3 style="margin:0">Sites</h3>${table(sites.length ? sites : [["—", "0"]])}
</div>`;
  return { subject, text, html };
}

export async function sendPeriodicReport(
  settings: SystemSettings,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ sent: boolean; reason?: string; recipients?: number }> {
  const now = opts.now ?? new Date();
  const recipients = recipientsOf(settings);
  if (settings.reportFrequency === "off" && !opts.force) return { sent: false, reason: "disabled" };
  if (!opts.force && !isReportDay(settings.reportFrequency, now)) return { sent: false, reason: "not_today" };
  if (recipients.length === 0) return { sent: false, reason: "no_recipients" };
  if (!emailConfigured()) return { sent: false, reason: "smtp_not_configured" };

  const days = settings.reportFrequency === "weekly" ? 7 : 1;
  const to = now;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const metrics = await computeMetrics(from, to);
  const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const { subject, text, html } = renderReport(settings.brandName, days === 1 ? fmt(from) : `${fmt(from)} a ${fmt(to)}`, metrics);
  await sendEmail(recipients.join(", "), subject, text, html);
  return { sent: true, recipients: recipients.length };
}
