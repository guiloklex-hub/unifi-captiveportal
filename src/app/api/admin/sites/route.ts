import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listSites } from "@/lib/unifi";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTROLLER_TIMEOUT_MS = 3_000;

/** Sites conhecidos pela controladora — best-effort, com timeout curto. */
async function controllerSites(): Promise<string[]> {
  try {
    const sites = await Promise.race([
      listSites(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CONTROLLER_TIMEOUT_MS)),
    ]);
    return sites.map((s) => s.name);
  } catch (err) {
    logger.debug({ err: (err as Error).message }, "sites: controladora indisponível, usando apenas o banco");
    return [];
  }
}

/** Sites para os filtros do painel: banco (guests/tokens) ∪ controladora. */
export async function GET() {
  const [regSites, tokenSites, fromController] = await Promise.all([
    prisma.guestRegistration.findMany({
      distinct: ["site"],
      select: { site: true },
      where: { site: { not: null } },
    }),
    prisma.accessToken.findMany({
      distinct: ["site"],
      select: { site: true },
    }),
    controllerSites(),
  ]);

  const set = new Set<string>();
  for (const r of regSites) if (r.site) set.add(r.site);
  for (const t of tokenSites) if (t.site) set.add(t.site);
  for (const s of fromController) set.add(s);
  if (set.size === 0) set.add("default");

  const sites = Array.from(set).sort((a, b) => a.localeCompare(b));

  return NextResponse.json(
    { sites },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
