import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function buildPortalBase(req: NextRequest): string {
  const envBase = process.env.PUBLIC_PORTAL_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const token = await prisma.accessToken.findUnique({
    where: { id },
    select: { code: true, site: true },
  });
  if (!token) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }

  const base = buildPortalBase(req);
  const site = encodeURIComponent(token.site || "default");
  const code = encodeURIComponent(token.code);
  const deepLink = `${base}/guest/s/${site}?token=${code}`;

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
