import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { portalBaseUrl, tokenDeepLink } from "@/lib/portalUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const token = await prisma.accessToken.findUnique({
    where: { id },
    select: { code: true, site: true },
  });
  if (!token) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }

  const deepLink = tokenDeepLink(portalBaseUrl(req.headers), token);

  const format = (new URL(req.url).searchParams.get("format") ?? "svg").toLowerCase();

  if (format === "png") {
    const buffer = await QRCode.toBuffer(deepLink, {
      type: "png",
      errorCorrectionLevel: "M",
      width: 512,
      margin: 1,
    });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Token-DeepLink": deepLink,
      },
    });
  }

  const svg = await QRCode.toString(deepLink, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Token-DeepLink": deepLink,
    },
  });
}
