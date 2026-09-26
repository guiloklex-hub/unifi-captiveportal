import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { invalidateSystemSettingsCache } from "@/lib/settings";
import { siteBrandingSchema } from "@/lib/settingsValidators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ site: string }> };

const SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function siteFrom(params: Params["params"]): Promise<string | null> {
  const { site } = await params;
  return SITE_RE.test(site) ? site : null;
}

/** Sobrescritas de marca do site (campos nulos herdam da marca global). */
export async function GET(_req: NextRequest, { params }: Params) {
  const site = await siteFrom(params);
  if (!site) return NextResponse.json({ error: "Site inválido" }, { status: 400 });
  const row = await prisma.siteBranding.findUnique({ where: { site } });
  return NextResponse.json(
    row ?? { site, brandName: null, logoUrl: null, backgroundUrl: null, primaryColor: null, termsOfUse: null },
  );
}

export async function PUT(req: NextRequest, { params }: Params) {
  const site = await siteFrom(params);
  if (!site) return NextResponse.json({ error: "Site inválido" }, { status: 400 });
  const parsed = siteBrandingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const data = parsed.data;
  const empty = Object.values(data).every((v) => v === null);
  if (empty) {
    await prisma.siteBranding.deleteMany({ where: { site } });
  } else {
    await prisma.siteBranding.upsert({ where: { site }, create: { site, ...data }, update: data });
  }
  invalidateSystemSettingsCache();
  return NextResponse.json({ site, ...data });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const site = await siteFrom(params);
  if (!site) return NextResponse.json({ error: "Site inválido" }, { status: 400 });
  await prisma.siteBranding.deleteMany({ where: { site } });
  invalidateSystemSettingsCache();
  return NextResponse.json({ ok: true });
}
