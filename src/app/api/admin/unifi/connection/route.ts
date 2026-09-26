import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  connectionInputSchema,
  getConnectionView,
  resetConnection,
  saveConnection,
} from "@/lib/unifi/connectionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getConnectionView());
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = connectionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  try {
    await saveConnection(parsed.data);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "UniFi connection save failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  logger.info({ url: parsed.data.url, authMode: parsed.data.authMode }, "UniFi connection updated via admin");
  return NextResponse.json(await getConnectionView());
}

export async function DELETE() {
  await resetConnection();
  logger.info("UniFi connection reset to .env");
  return NextResponse.json(await getConnectionView());
}
