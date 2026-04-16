import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "config" },
  });
  return NextResponse.json(settings ?? {});
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { brandName, logoUrl, backgroundUrl, primaryColor, termsOfUse } = body;

  const settings = await prisma.systemSettings.upsert({
    where: { id: "config" },
    update: {
      brandName,
      logoUrl,
      backgroundUrl,
      primaryColor,
      termsOfUse,
    },
    create: {
      id: "config",
      brandName,
      logoUrl,
      backgroundUrl,
      primaryColor,
      termsOfUse,
    },
  });

  return NextResponse.json(settings);
}
