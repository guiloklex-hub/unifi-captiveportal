import { z } from "zod";
import { prisma } from "../prisma";
import { onlyDigits, normalizeForeignDocument } from "../validators";

/**
 * Regras de acesso definidas pelo admin:
 *   block  impede o acesso (por MAC, CPF, e-mail ou documento)
 *   allow  dispositivo liberado (por MAC): conecta com um clique, sem formulário
 *          nem token — útil para equipe, TVs e dispositivos de parceiros.
 * Regras podem expirar (`expiresAt`).
 */

export type RuleKind = "block" | "allow";
export type MatchType = "mac" | "cpf" | "email" | "document";

const MAC_RE = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i;

/** Normaliza o valor para comparação (MAC "aa:bb:…", CPF só dígitos, e-mail minúsculo…). */
export function normalizeRuleValue(type: MatchType, raw: string): string {
  const v = (raw ?? "").trim();
  if (type === "mac") {
    const hex = v.toLowerCase().replace(/[^0-9a-f]/g, "");
    return hex.length === 12 ? hex.match(/.{2}/g)!.join(":") : v.toLowerCase();
  }
  if (type === "cpf") return onlyDigits(v);
  if (type === "email") return v.toLowerCase();
  return normalizeForeignDocument(v);
}

export const accessRuleSchema = z
  .object({
    kind: z.enum(["block", "allow"]),
    matchType: z.enum(["mac", "cpf", "email", "document"]),
    value: z.string().trim().min(3).max(160),
    reason: z.string().trim().max(200).optional().nullable(),
    durationMin: z.coerce.number().int().min(1).max(525_600).optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "allow" && r.matchType !== "mac") {
      ctx.addIssue({ code: "custom", path: ["matchType"], message: "Liberação é feita por MAC do dispositivo" });
    }
    if (r.matchType === "mac" && !MAC_RE.test(r.value.trim())) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "MAC inválido" });
    }
  })
  .transform((r) => ({ ...r, value: normalizeRuleValue(r.matchType, r.value) }));

function active() {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}

export type BlockCheck = { mac: string; cpf?: string | null; email?: string | null; document?: string | null };

/** Regra de bloqueio que casa com qualquer identificador informado (ou null). */
export async function findBlockingRule(c: BlockCheck) {
  const or: { matchType: MatchType; value: string }[] = [{ matchType: "mac", value: normalizeRuleValue("mac", c.mac) }];
  if (c.cpf) or.push({ matchType: "cpf", value: normalizeRuleValue("cpf", c.cpf) });
  if (c.email) or.push({ matchType: "email", value: normalizeRuleValue("email", c.email) });
  if (c.document) or.push({ matchType: "document", value: normalizeRuleValue("document", c.document) });
  return prisma.accessRule.findFirst({ where: { kind: "block", AND: [{ OR: or }, active()] } });
}

export async function findAllowRule(mac: string) {
  return prisma.accessRule.findFirst({
    where: { kind: "allow", matchType: "mac", value: normalizeRuleValue("mac", mac), ...active() },
  });
}
