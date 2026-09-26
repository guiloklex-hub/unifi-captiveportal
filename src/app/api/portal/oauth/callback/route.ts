import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { completeOAuthLogin, portalPublicBase } from "@/lib/portal/oauth";

export const runtime = "nodejs";

/** Retorno do provedor: conclui o login e devolve o guest ao portal com um ticket. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const base = portalPublicBase() ?? req.nextUrl.origin;
  const state = sp.get("state") ?? "";
  const code = sp.get("code") ?? "";

  if (!state || !code) {
    logger.warn({ error: sp.get("error") }, "social login cancelled or failed at provider");
    return NextResponse.redirect(new URL("/portal?socialError=cancelled", base));
  }

  try {
    const { ticket, context } = await completeOAuthLogin(state, code);
    const back = new URL("/portal", base);
    back.searchParams.set("id", context.mac);
    if (context.apMac) back.searchParams.set("ap", context.apMac);
    if (context.ssid) back.searchParams.set("ssid", context.ssid);
    if (context.site) back.searchParams.set("site", context.site);
    if (context.originalUrl) back.searchParams.set("url", context.originalUrl);
    back.searchParams.set("social", ticket);
    return NextResponse.redirect(back);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "social login callback failed");
    return NextResponse.redirect(new URL("/portal?socialError=callback", base));
  }
}
