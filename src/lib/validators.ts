import { z } from "zod";

export function onlyDigits(value: string): string {
  return (value ?? "").replace(/\D+/g, "");
}

// Validação matemática de CPF (algoritmo oficial Receita Federal)
export function isValidCPF(raw: string): boolean {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (slice: string, factor: number): number => {
    let total = 0;
    for (const ch of slice) {
      total += parseInt(ch, 10) * factor--;
    }
    const mod = (total * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calcDigit(cpf.substring(0, 9), 10);
  if (d1 !== parseInt(cpf[9], 10)) return false;
  const d2 = calcDigit(cpf.substring(0, 10), 11);
  if (d2 !== parseInt(cpf[10], 10)) return false;
  return true;
}

// Celular brasileiro: 11 dígitos, DDD válido (11-99), nono dígito 9
export function isValidBrazilCell(raw: string): boolean {
  const phone = onlyDigits(raw);
  if (phone.length !== 11) return false;
  const ddd = parseInt(phone.substring(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  if (phone[2] !== "9") return false;
  return true;
}

/** Telefone internacional: "+" seguido de 8 a 15 dígitos (E.164). */
export function isValidIntlPhone(raw: string): boolean {
  const v = (raw ?? "").trim();
  if (!v.startsWith("+")) return false;
  const digits = onlyDigits(v);
  return digits.length >= 8 && digits.length <= 15;
}

/** Normaliza telefone: celular BR → 11 dígitos; internacional → "+<dígitos>". */
export function normalizePhone(raw: string): string {
  const v = (raw ?? "").trim();
  return v.startsWith("+") ? `+${onlyDigits(v)}` : onlyDigits(v);
}

/** Passaporte / documento estrangeiro: 5–20 caracteres alfanuméricos. */
export function isValidForeignDocument(raw: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(normalizeForeignDocument(raw));
}

export function normalizeForeignDocument(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { FieldMode } from "@/lib/settings";

const MAC_RE = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i;
const SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type PortalFormConfig = {
  requireToken?: boolean;
  fieldName?: FieldMode;
  fieldEmail?: FieldMode;
  fieldPhone?: FieldMode;
  fieldDocument?: FieldMode;
  allowForeignDocument?: boolean;
};

/**
 * Campos injetados pela controladora na URL (ocultos no formulário). São
 * saneados em vez de rejeitados: um valor inesperado não pode impedir o guest
 * de se conectar.
 */
export const unifiContextSchema = z.object({
  mac: z.string().trim().regex(MAC_RE),
  apMac: z
    .string()
    .nullish()
    .transform((v) => (v && MAC_RE.test(v.trim()) ? v.trim() : null)),
  ssid: z
    .string()
    .nullish()
    .transform((v) => (v ? v.slice(0, 64) : null)),
  // Nome curto do site UniFi (vai para o path da API: /api/s/<site>/...).
  site: z
    .string()
    .nullish()
    .transform((v) => (v && SITE_RE.test(v.trim()) ? v.trim() : null)),
  originalUrl: z
    .string()
    .nullish()
    .transform((v) => (v ? v.slice(0, 2048) : null)),
  fingerprint: z.string().trim().min(16).max(128).optional().nullable(),
});

/**
 * Schema do cadastro do guest. Cada campo pode ser obrigatório, opcional ou
 * oculto (configurado em Customização → Formulário). Com `allowForeignDocument`,
 * o guest pode informar passaporte + telefone internacional em vez de CPF.
 */
export const getGuestRegistrationSchema = (dict: Dictionary["validation"], opts: PortalFormConfig = {}) => {
  const mode = {
    name: opts.fieldName ?? "required",
    email: opts.fieldEmail ?? "required",
    phone: opts.fieldPhone ?? "required",
    document: opts.fieldDocument ?? "required",
  };
  const text = (max: number) =>
    z
      .string()
      .nullish()
      .transform((v) => (v ?? "").trim().slice(0, max));

  return z
    .object({
      fullName: text(120),
      email: text(160).transform((v) => v.toLowerCase()),
      phone: text(40),
      cpf: text(20).transform(onlyDigits),
      documentType: z
        .enum(["cpf", "passport"])
        .nullish()
        .transform((v) => (opts.allowForeignDocument && v === "passport" ? "passport" : "cpf")),
      document: text(40).transform(normalizeForeignDocument),
      acceptTerms: z.literal(true, { error: dict.valTermsRequired }),
      mac: z.string().trim().regex(MAC_RE, dict.valMacMissing),
      apMac: unifiContextSchema.shape.apMac,
      ssid: unifiContextSchema.shape.ssid,
      site: unifiContextSchema.shape.site,
      originalUrl: unifiContextSchema.shape.originalUrl,
      token: opts.requireToken
        ? z.string().trim().min(8, dict.valTokenRequired)
        : z.string().optional().nullable(),
      fingerprint: unifiContextSchema.shape.fingerprint,
    })
    .superRefine((v, ctx) => {
      const need = (m: FieldMode, value: string) => m === "required" || (m === "optional" && value !== "");
      const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

      if (mode.name !== "hidden" && need(mode.name, v.fullName)) {
        if (v.fullName.length < 3) issue("fullName", dict.valNameRequired);
        else if (!v.fullName.includes(" ")) issue("fullName", dict.valNameFull);
      }
      if (mode.email !== "hidden" && need(mode.email, v.email)) {
        if (!z.email().safeParse(v.email).success) issue("email", dict.valEmailInvalid);
      }
      const foreign = v.documentType === "passport";
      if (mode.phone !== "hidden" && need(mode.phone, v.phone)) {
        const ok = isValidBrazilCell(v.phone) || (foreign && isValidIntlPhone(v.phone));
        if (!ok) issue("phone", dict.valPhoneInvalid);
      }
      if (mode.document !== "hidden") {
        if (foreign) {
          if (need(mode.document, v.document) && !isValidForeignDocument(v.document)) {
            issue("document", dict.valDocumentInvalid);
          }
        } else if (need(mode.document, v.cpf) && !isValidCPF(v.cpf)) {
          issue("cpf", dict.valCpfInvalid);
        }
      }
    })
    .transform((v) => {
      const foreign = v.documentType === "passport";
      return {
        ...v,
        fullName: mode.name === "hidden" ? "" : v.fullName,
        email: mode.email === "hidden" ? "" : v.email,
        phone: mode.phone === "hidden" ? "" : normalizePhone(v.phone),
        cpf: mode.document === "hidden" || foreign ? "" : v.cpf,
        document: mode.document === "hidden" || !foreign || !v.document ? null : v.document,
        documentType: mode.document === "hidden" ? null : v.documentType,
      };
    });
};

export type GuestRegistrationInput = z.output<ReturnType<typeof getGuestRegistrationSchema>>;
export type GuestRegistrationFormValues = z.input<ReturnType<typeof getGuestRegistrationSchema>>;

/**
 * Identidade do visitante para métricas (visitantes únicos, recorrência):
 * CPF → documento → e-mail → MAC, nessa ordem.
 */
export function visitorKeyOf(g: { cpf?: string | null; document?: string | null; email?: string | null; mac: string }): string {
  if (g.cpf) return g.cpf;
  if (g.document) return `doc:${g.document}`;
  if (g.email) return `email:${g.email.toLowerCase()}`;
  return `mac:${g.mac.toLowerCase()}`;
}
