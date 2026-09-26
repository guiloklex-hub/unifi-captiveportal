import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSystemSettings } from "@/lib/settings";
import { unifiContextSchema } from "@/lib/validators";
import { availableProviders, startOAuthLogin, type OAuthProvider } from "@/lib/portal/oauth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

type Params = { params: Promise<{ provider: string }> };

/** Inicia o login social e redireciona o guest ao provedor. */
export async function GET(req: NextRequest, { params }: Params) {
  const { provider } = await params;
  const sp = req.nextUrl.searchParams;
  const back = new URL(`/portal?${sp.toString()}`, req.nextUrl.origin);

  const settings = await getSystemSettings();
  if (!(availableProviders(settings) as string[]).includes(provider)) {
    back.searchParams.set("socialError", "unavailable");
    return NextResponse.redirect(back);
  }

  const rl = rateLimit(`oauth-start:${clientIp(req.headers)}:${sp.get("id") ?? ""}`, 10, 60_000);
  if (!rl.allowed) {
    back.searchParams.set("socialError", "rate");
    return NextResponse.redirect(back);
  }

  const ctx = unifiContextSchema.safeParse({
    mac: sp.get("id") ?? sp.get("mac") ?? "",
    apMac: sp.get("ap"),
    ssid: sp.get("ssid"),
    site: sp.get("site"),
    originalUrl: sp.get("url"),
  });
  if (!ctx.success) {
    back.searchParams.set("socialError", "context");
    return NextResponse.redirect(back);
  }

  try {
    const { fingerprint: _fp, ...context } = ctx.data;
    void _fp;
    const url = await startOAuthLogin(provider as OAuthProvider, { ...context, mac: context.mac.toLowerCase() });
    return NextResponse.redirect(url);
  } catch (err) {
    logger.error({ provider, err: (err as Error).message }, "social login start failed");
    back.searchParams.set("socialError", "start");
    return NextResponse.redirect(back);
  }
}
