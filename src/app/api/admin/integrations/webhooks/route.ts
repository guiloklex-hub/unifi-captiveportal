import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { WEBHOOK_EVENTS, generateWebhookSecret } from "@/lib/integrations/webhooks";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\//.test(v) && URL.canParse(v), "URL http(s) inválida"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  includePii: z.boolean().default(false),
});

const select = {
  id: true,
  name: true,
  url: true,
  events: true,
  includePii: true,
  enabled: true,
  createdAt: true,
  lastDeliveryAt: true,
  lastStatus: true,
  lastError: true,
} as const;

export async function GET() {
  return NextResponse.json({ webhooks: await prisma.webhook.findMany({ select, orderBy: { createdAt: "asc" } }) });
}

/** Cria o webhook e devolve o segredo de assinatura UMA única vez. */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const secret = generateWebhookSecret();
  const webhook = await prisma.webhook.create({
    data: { ...parsed.data, events: parsed.data.events.join(","), secretEnc: encryptSecret(secret) },
    select,
  });
  await audit(req, "webhook.create", parsed.data.url, { events: parsed.data.events, includePii: parsed.data.includePii });
  return NextResponse.json({ webhook, secret }, { status: 201 });
}
