import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenLocks } from "@/lib/tokenLocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "config" },
  });
  const locks = getTokenLocks();
  // Quando há lock de requireToken, o valor efetivo vem da env e ignora o BD.
  const effective = locks.requireToken !== undefined
    ? { ...settings, requireToken: locks.requireToken }
    : settings;
  return NextResponse.json(effective ?? {});
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { brandName, logoUrl, backgroundUrl, primaryColor, termsOfUse, requireToken } = body;

  const locks = getTokenLocks();
  const requireTokenFinal =
    locks.requireToken !== undefined ? locks.requireToken : Boolean(requireToken);

  const settings = await prisma.systemSettings.upsert({
    where: { id: "config" },
    update: {
      brandName,
      logoUrl,
      backgroundUrl,
      primaryColor,
      termsOfUse,
      requireToken: requireTokenFinal,
    },
    create: {
      id: "config",
      brandName,
      logoUrl,
      backgroundUrl,
      primaryColor,
      termsOfUse,
      requireToken: requireTokenFinal,
    },
  });

  return NextResponse.json(settings);
}
