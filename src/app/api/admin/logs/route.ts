import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { csvHeaderLine, csvRow, type CSVColumn } from "@/lib/csv";
import { jsonSafe } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSV_CHUNK = 500;

type LogRow = {
  id: number;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  mac: string;
  ssid: string;
  site: string;
  tokenCode: string;
  tokenDescription: string;
  autorizadoEm: string;
};

const CSV_COLUMNS: CSVColumn<LogRow>[] = [
  { key: "id", header: "ID" },
  { key: "nome", header: "Nome" },
  { key: "cpf", header: "CPF" },
  { key: "email", header: "E-mail" },
  { key: "telefone", header: "Telefone" },
  { key: "mac", header: "MAC" },
  { key: "ssid", header: "SSID" },
  { key: "site", header: "Site" },
  { key: "tokenCode", header: "Token" },
  { key: "tokenDescription", header: "Token (descrição)" },
  { key: "autorizadoEm", header: "Autorizado em" },
];

function buildWhere(sp: URLSearchParams): Prisma.GuestRegistrationWhereInput {
  const where: Prisma.GuestRegistrationWhereInput = {};
  const q = sp.get("q")?.trim() ?? "";
  const from = sp.get("from");
  const to = sp.get("to");

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
  return where;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const where = buildWhere(sp);
  const format = sp.get("format");
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10)));

  if (format === "csv") {
    // Streaming: lê o banco em chunks de CSV_CHUNK linhas, emite cada chunk no
    // body da resposta. Memória constante mesmo com 100k+ registros; substitui
    // o limite anterior de 10k linhas em memória.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(csvHeaderLine(CSV_COLUMNS) + "\n"));
          let cursorId: number | undefined;
          for (;;) {
            const batch = await prisma.guestRegistration.findMany({
              where,
              orderBy: { id: "desc" },
              take: CSV_CHUNK,
              ...(cursorId !== undefined
                ? { cursor: { id: cursorId }, skip: 1 }
                : {}),
              include: { token: { select: { code: true, description: true } } },
            });
            if (batch.length === 0) break;
            for (const r of batch) {
              const row: LogRow = {
                id: r.id,
                nome: r.fullName,
                cpf: r.cpf,
                email: r.email,
                telefone: r.phone,
                mac: r.macAddress,
                ssid: r.ssid ?? "",
                site: r.site ?? "",
                tokenCode: r.token?.code ?? "",
                tokenDescription: r.token?.description ?? "",
                autorizadoEm: r.authorizedAt.toISOString(),
              };
              controller.enqueue(encoder.encode(csvRow(row, CSV_COLUMNS) + "\n"));
            }
            cursorId = batch[batch.length - 1].id;
            if (batch.length < CSV_CHUNK) break;
          }
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="logs-${Date.now()}.csv"`,
        "cache-control": "no-store",
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
      include: { token: { select: { id: true, code: true, description: true } } },
    }),
  ]);

  return NextResponse.json(jsonSafe({ total, rows, page, pageSize }));
}
