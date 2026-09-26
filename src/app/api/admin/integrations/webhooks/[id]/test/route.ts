import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deliverWithRetry } from "@/lib/integrations/webhooks";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Envia um evento de teste (guest.authorized com dados fictícios) e devolve o resultado. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const hook = await prisma.webhook.findUnique({ where: { id } });
  if (!hook) return NextResponse.json({ error: "Webhook não encontrado" }, { status: 404 });
  const result = await deliverWithRetry({ ...hook, url: hook.url }, "guest.authorized", {
    data: {
      test: true,
      registrationId: 0,
      authorizedAt: new Date().toISOString(),
      mac: "00:00:00:00:00:00",
      site: "default",
      authMethod: "form",
      durationMin: 60,
      marketingConsent: false,
    },
    pii: { fullName: "Convidado Teste", email: "teste@exemplo.com" },
  });
  return NextResponse.json(result, { status: result.error ? 502 : 200 });
}
