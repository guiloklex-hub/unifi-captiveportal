import { createHmac, randomBytes } from "crypto";
import { fetch } from "undici";
import { prisma } from "../prisma";
import { logger } from "../logger";
import { decryptSecret } from "../crypto";

/**
 * Webhooks de saída. Cada entrega é um POST JSON:
 *
 *   { "event": "guest.authorized", "id": "<uuid>", "createdAt": "...", "data": { ... } }
 *
 * Cabeçalhos:
 *   X-Portal-Event:      nome do evento
 *   X-Portal-Delivery:   id único da entrega (idempotência no receptor)
 *   X-Portal-Timestamp:  epoch em segundos
 *   X-Portal-Signature:  sha256=<HMAC-SHA256(secret, "<timestamp>.<corpo>")>
 *
 * Entrega assíncrona (não atrasa o guest), 3 tentativas com backoff (0 s, 5 s, 30 s).
 * Para integrar CRMs (RD Station, HubSpot, Mailchimp…), aponte para n8n/Make/Zapier.
 */

export const WEBHOOK_EVENTS = ["guest.authorized", "guest.revoked", "rule.created"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const RETRY_DELAYS_MS = [0, 5_000, 30_000];
const TIMEOUT_MS = 8_000;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Dados pessoais só vão para webhooks marcados com "incluir dados pessoais". */
export type EventPayload = { data: Record<string, unknown>; pii?: Record<string, unknown> };

type Target = { id: string; url: string; secretEnc: string; includePii: boolean };

async function deliverOnce(target: Target, event: WebhookEvent, body: string, deliveryId: string): Promise<number> {
  const timestamp = Math.floor(Date.now() / 1000);
  const res = await fetch(target.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "unifi-captive-portal-webhook/1",
      "x-portal-event": event,
      "x-portal-delivery": deliveryId,
      "x-portal-timestamp": String(timestamp),
      "x-portal-signature": signPayload(decryptSecret(target.secretEnc), timestamp, body),
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.body?.cancel().catch(() => undefined);
  return res.status;
}

export async function deliverWithRetry(target: Target, event: WebhookEvent, payload: EventPayload): Promise<{ status: number | null; error: string | null }> {
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({
    event,
    id: deliveryId,
    createdAt: new Date().toISOString(),
    data: target.includePii && payload.pii ? { ...payload.data, ...payload.pii } : payload.data,
  });

  let status: number | null = null;
  let error: string | null = null;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      status = await deliverOnce(target, event, body, deliveryId);
      error = status >= 200 && status < 300 ? null : `HTTP ${status}`;
      if (!error || (status >= 400 && status < 500 && status !== 429)) break; // 4xx (exceto 429) não adianta repetir
    } catch (err) {
      status = null;
      error = (err as Error).message;
    }
  }

  await prisma.webhook
    .update({ where: { id: target.id }, data: { lastDeliveryAt: new Date(), lastStatus: status, lastError: error } })
    .catch(() => undefined);
  if (error) logger.warn({ webhookId: target.id, event, error }, "webhook delivery failed");
  return { status, error };
}

/** Dispara o evento para todos os webhooks inscritos, sem bloquear quem chamou. */
export function emitEvent(event: WebhookEvent, payload: EventPayload): void {
  void (async () => {
    try {
      const hooks = await prisma.webhook.findMany({ where: { enabled: true } });
      const targets = hooks.filter((h) => h.events.split(",").map((e) => e.trim()).includes(event));
      await Promise.all(targets.map((t) => deliverWithRetry(t, event, payload)));
    } catch (err) {
      logger.warn({ event, err: (err as Error).message }, "webhook dispatch failed");
    }
  })();
}
