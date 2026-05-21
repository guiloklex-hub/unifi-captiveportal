import { NextRequest, NextResponse } from "next/server";
import { isValidCPF, onlyDigits } from "@/lib/validators";
import { revokeActiveCpfSessions } from "@/lib/cpfLock";
import { unauthorizeGuest } from "@/lib/unifi";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Libera manualmente um CPF que esteja bloqueado pela regra de "1 dispositivo
 * por CPF". Marca todas as sessões vivas do CPF como revogadas no banco e
 * tenta desautorizar cada MAC na UniFi (best-effort: falhas na UniFi não
 * desfazem a revogação local).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const rawCpf = typeof (body as { cpf?: unknown })?.cpf === "string" ? (body as { cpf: string }).cpf : "";
  const cpf = onlyDigits(rawCpf);
  if (!isValidCPF(cpf)) {
    return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
  }

  const macs = await revokeActiveCpfSessions(cpf);

  if (macs.length === 0) {
    return NextResponse.json({ ok: true, released: 0, macs: [] });
  }

  const log = logger.child({ cpf, released: macs.length });

  await Promise.all(
    macs.map((mac) =>
      unauthorizeGuest(mac).catch((err) =>
        log.warn({ mac, err: (err as Error).message }, "unauthorize failed on UniFi"),
      ),
    ),
  );

  log.info("CPF released by admin");
  return NextResponse.json({ ok: true, released: macs.length, macs });
}
