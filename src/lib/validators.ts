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

import type { Dictionary } from "@/lib/i18n/dictionaries";

const MAC_RE = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i;
const SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const getGuestRegistrationSchema = (
  dict: Dictionary["validation"],
  opts: { requireToken?: boolean } = {},
) =>
  z.object({
    fullName: z
      .string()
      .trim()
      .min(3, dict.valNameRequired)
      .max(120, dict.valNameLong)
      .refine((v) => v.includes(" "), dict.valNameFull),
    email: z.string().trim().toLowerCase().email(dict.valEmailInvalid).max(160),
    phone: z
      .string()
      .transform(onlyDigits)
      .refine(isValidBrazilCell, dict.valPhoneInvalid),
    cpf: z.string().transform(onlyDigits).refine(isValidCPF, dict.valCpfInvalid),
    acceptTerms: z.literal(true, { error: dict.valTermsRequired }),
    mac: z.string().trim().regex(MAC_RE, dict.valMacMissing),
    // Campos injetados pela controladora na URL (ocultos no formulário). São
    // saneados em vez de rejeitados: um valor inesperado não pode impedir o
    // guest de se conectar.
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
    token: opts.requireToken
      ? z.string().trim().min(8, dict.valTokenRequired)
      : z.string().optional().nullable(),
    fingerprint: z.string().trim().min(16).max(128).optional().nullable(),
  });

export type GuestRegistrationInput = z.output<ReturnType<typeof getGuestRegistrationSchema>>;
export type GuestRegistrationFormValues = z.input<ReturnType<typeof getGuestRegistrationSchema>>;
