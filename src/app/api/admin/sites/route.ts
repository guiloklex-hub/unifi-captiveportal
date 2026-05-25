import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [regSites, tokenSites] = await Promise.all([
    prisma.guestRegistration.findMany({
      distinct: ["site"],
      select: { site: true },
      where: { site: { not: null } },
    }),
    prisma.accessToken.findMany({
      distinct: ["site"],
      select: { site: true },
    }),
  ]);

  const set = new Set<string>();
  for (const r of regSites) if (r.site) set.add(r.site);
  for (const t of tokenSites) if (t.site) set.add(t.site);
  if (set.size === 0) set.add("default");

  const sites = Array.from(set).sort((a, b) => a.localeCompare(b));

  return NextResponse.json(
    { sites },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
