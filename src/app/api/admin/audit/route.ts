import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { csvHeaderLine, csvRow, type CSVColumn } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { id: number; at: string; actor: string; action: string; target: string; details: string; ip: string };
const COLUMNS: CSVColumn<Row>[] = [
  { key: "id", header: "ID" },
  { key: "at", header: "Data/hora" },
  { key: "actor", header: "Usuário" },
  { key: "action", header: "Ação" },
  { key: "target", header: "Alvo" },
  { key: "details", header: "Detalhes" },
  { key: "ip", header: "IP" },
];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const where: Prisma.AuditLogWhereInput = {};
  const actor = sp.get("actor")?.trim();
  const action = sp.get("action")?.trim();
  const q = sp.get("q")?.trim();
  if (actor) where.actor = actor;
  if (action) where.action = { startsWith: action };
  if (q) where.OR = [{ target: { contains: q } }, { details: { contains: q } }];

  if (sp.get("format") === "csv") {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, take: 50_000 });
    const body = [
      csvHeaderLine(COLUMNS),
      ...rows.map((r) =>
        csvRow<Row>(
          { ...r, at: r.at.toISOString(), target: r.target ?? "", details: r.details ?? "", ip: r.ip ?? "" },
          COLUMNS,
        ),
      ),
    ].join("\n");
    return new NextResponse(`${body}\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10)));
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return NextResponse.json({ total, page, pageSize, rows });
}
