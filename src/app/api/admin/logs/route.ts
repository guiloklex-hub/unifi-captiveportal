import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toCSV } from "@/lib/csv";
import { jsonSafe, } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const from = sp.get("from");
  const to = sp.get("to");
  const format = sp.get("format");
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10)));

  const where: Prisma.GuestRegistrationWhereInput = {};
  if (q) {
    where.OR = [
      { fullName: { contains: q } },
      { cpf: { contains: q.replace(/\D+/g, "") } },
      { email: { contains: q } },
    ];
  }
  if (from || to) {
    where.authorizedAt = {};
    if (from) where.authorizedAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.authorizedAt.lte = new Date(`${to}T23:59:59`);
  }

  if (format === "csv") {
    const rows = await prisma.guestRegistration.findMany({
      where,
      orderBy: { authorizedAt: "desc" },
      take: 10000,
    });
    const csv = toCSV(
      rows.map((r) => ({
        id: r.id,
        nome: r.fullName,
        cpf: r.cpf,
        email: r.email,
        telefone: r.phone,
        mac: r.macAddress,
        ssid: r.ssid ?? "",
        autorizadoEm: r.authorizedAt.toISOString(),
      })),
      [
        { key: "id", header: "ID" },
        { key: "nome", header: "Nome" },
        { key: "cpf", header: "CPF" },
        { key: "email", header: "E-mail" },
        { key: "telefone", header: "Telefone" },
        { key: "mac", header: "MAC" },
        { key: "ssid", header: "SSID" },
        { key: "autorizadoEm", header: "Autorizado em" },
      ],
    );
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="logs-${Date.now()}.csv"`,
      },
    });
  }

  const [total, rows] = await Promise.all([
    prisma.guestRegistration.count({ where }),
    prisma.guestRegistration.findMany({
      where,
      orderBy: { authorizedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json(jsonSafe({ total, rows, page, pageSize }));
}
