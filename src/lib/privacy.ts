import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { onlyDigits, normalizeForeignDocument } from "./validators";
import { resolveBranding, type SystemSettings } from "./settings";

/**
 * Apoio à LGPD:
 *  - versão dos termos aceitos (hash + texto guardado em TermsVersion);
 *  - anonimização: remove dados pessoais mantendo o registro de conexão
 *    (MAC, IP, data/hora, duração) exigido pelo Marco Civil (art. 13);
 *  - localização/exportação dos dados de um titular.
 */

export function termsHashOf(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

const known = new Set<string>();

/** Hash dos termos vigentes do site, garantindo que o texto esteja arquivado. */
export async function currentTermsHash(settings: SystemSettings, site?: string | null): Promise<string> {
  const { termsOfUse } = await resolveBranding(settings, site);
  const hash = termsHashOf(termsOfUse);
  if (!known.has(hash)) {
    await prisma.termsVersion.upsert({ where: { hash }, create: { hash, text: termsOfUse.trim() }, update: {} }).catch(() => undefined);
    known.add(hash);
  }
  return hash;
}

/** Campos pessoais zerados na anonimização. */
export function anonymizedFields(): Prisma.GuestRegistrationUpdateManyMutationInput {
  return {
    fullName: "",
    email: "",
    phone: "",
    cpf: "",
    document: null,
    documentType: null,
    fingerprint: null,
    marketingConsent: false,
    anonymizedAt: new Date(),
  };
}

/**
 * Anonimiza registros e troca a chave de visitante por uma chave opaca
 * (a contagem de visitantes únicos antigos deixa de ser possível).
 */
export async function anonymizeRegistrations(where: Prisma.GuestRegistrationWhereInput): Promise<number> {
  const target = { ...where, anonymizedAt: null };
  const rows = await prisma.guestRegistration.findMany({ where: target, select: { id: true } });
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  await prisma.guestRegistration.updateMany({ where: { id: { in: ids } }, data: anonymizedFields() });
  // visitorKey precisa ser por linha (updateMany não interpola o id).
  await prisma.$transaction(
    ids.map((id) => prisma.guestRegistration.update({ where: { id }, data: { visitorKey: `anon:${id}` } })),
  );
  return ids.length;
}

export type SubjectQuery = { cpf?: string; email?: string; document?: string; phone?: string };

/** Filtro por titular — ao menos um identificador exato é exigido. */
export function subjectWhere(q: SubjectQuery): Prisma.GuestRegistrationWhereInput | null {
  const or: Prisma.GuestRegistrationWhereInput[] = [];
  const cpf = onlyDigits(q.cpf ?? "");
  if (cpf.length === 11) or.push({ cpf });
  if (q.email?.includes("@")) or.push({ email: q.email.trim().toLowerCase() });
  const doc = normalizeForeignDocument(q.document ?? "");
  if (doc.length >= 5) or.push({ document: doc });
  const phone = (q.phone ?? "").trim();
  if (onlyDigits(phone).length >= 8) or.push({ phone: phone.startsWith("+") ? `+${onlyDigits(phone)}` : onlyDigits(phone) });
  return or.length ? { OR: or } : null;
}

export async function exportSubject(where: Prisma.GuestRegistrationWhereInput) {
  const rows = await prisma.guestRegistration.findMany({
    where,
    orderBy: { authorizedAt: "asc" },
    include: { token: { select: { code: true, description: true } } },
  });
  const hashes = [...new Set(rows.map((r) => r.termsHash).filter((h): h is string => Boolean(h)))];
  const terms = hashes.length
    ? await prisma.termsVersion.findMany({ where: { hash: { in: hashes } } })
    : [];
  return {
    generatedAt: new Date().toISOString(),
    registrations: rows.map((r) => ({
      authorizedAt: r.authorizedAt.toISOString(),
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      cpf: r.cpf,
      documentType: r.documentType,
      document: r.document,
      macAddress: r.macAddress,
      ipAddress: r.ipAddress,
      ssid: r.ssid,
      site: r.site,
      userAgent: r.userAgent,
      durationMin: r.durationMin,
      bytesTx: r.bytesTx?.toString() ?? null,
      bytesRx: r.bytesRx?.toString() ?? null,
      authMethod: r.authMethod,
      token: r.token?.code ?? null,
      termsHash: r.termsHash,
      marketingConsent: r.marketingConsent,
      anonymizedAt: r.anonymizedAt?.toISOString() ?? null,
    })),
    termsAccepted: terms.map((t) => ({ hash: t.hash, firstSeenAt: t.createdAt.toISOString(), text: t.text })),
  };
}

/** Dias de retenção de dados pessoais (0 = desligado). */
export function piiRetentionDays(): number {
  const n = parseInt(process.env.PII_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 0;
}
