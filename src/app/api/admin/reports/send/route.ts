import { NextRequest, NextResponse } from "next/server";
import { getSystemSettings } from "@/lib/settings";
import { sendPeriodicReport } from "@/lib/integrations/reports";
import { audit } from "@/lib/admin/audit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Envia o relatório periódico. Cron diário (ex.: 08:05) com Bearer CRON_SECRET:
 * o endpoint decide se é dia de envio. `?force=1` envia agora (botão do painel).
 */
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const result = await sendPeriodicReport(await getSystemSettings(), { force });
    if (result.sent) await audit(req, "report.sent", null, { recipients: result.recipients, force });
    return NextResponse.json(result, { status: result.sent || !force ? 200 : 400 });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "report send failed");
    return NextResponse.json({ sent: false, reason: "send_failed", error: (err as Error).message }, { status: 502 });
  }
}
