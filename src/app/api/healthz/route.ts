import { NextResponse } from "next/server";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { checkUnifiHealth } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";
import { getBuildInfo } from "@/lib/buildInfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISK_WARN_PCT = 20; // alerta quando livre < 20%

async function checkDisk() {
  try {
    const dbPath = (process.env.DATABASE_URL ?? "file:./prisma/dev.db").replace(/^file:/, "");
    const dir = path.dirname(path.resolve(dbPath));
    const s = await statfs(dir);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    const freePct = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;
    return {
      status: freePct >= DISK_WARN_PCT ? ("ok" as const) : ("degraded" as const),
      freeBytes,
      totalBytes,
      freePct: Number(freePct.toFixed(1)),
    };
  } catch (err) {
    return {
      status: "down" as const,
      error: (err as Error).message,
    };
  }
}

export async function GET() {
  const startedAt = new Date().toISOString();

  const [unifi, db, disk] = await Promise.allSettled([
    checkUnifiHealth(),
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const),
    checkDisk(),
  ]);

  const unifiResult =
    unifi.status === "fulfilled"
      ? unifi.value
      : { status: "down" as const, circuitOpenUntil: null, cachedSessionValid: false, failures: 0 };

  const dbResult = db.status === "fulfilled" ? "ok" : "down";

  const diskResult =
    disk.status === "fulfilled"
      ? disk.value
      : { status: "down" as const, error: "statfs failed" };

  const subsystems = [unifiResult.status, dbResult, diskResult.status];
  const overall = subsystems.includes("down")
    ? "down"
    : subsystems.includes("degraded")
      ? "degraded"
      : "ok";

  // 200 quando ok/degraded; 503 só em down de subsistema crítico (DB/disco).
  // UniFi down não derruba o serviço — guests novos falham mas painel/UI vive.
  const httpStatus = dbResult === "down" || diskResult.status === "down" ? 503 : 200;

  return NextResponse.json(
    {
      status: overall,
      checkedAt: startedAt,
      version: getBuildInfo(),
      unifi: unifiResult,
      db: dbResult,
      disk: diskResult,
    },
    { status: httpStatus },
  );
}
