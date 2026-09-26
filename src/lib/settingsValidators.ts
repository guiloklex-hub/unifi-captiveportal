import { z } from "zod";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * Aceita string vazia (remove), caminho de upload local (`/api/uploads/<arquivo>`,
 * retornado por /api/admin/upload, ou o legado `/uploads/...`) ou URL absoluta http(s).
 * Rejeita `javascript:`, `data:`, `vbscript:` e qualquer outro scheme — defesa
 * contra XSS via `<img src>` injetado pelo admin.
 */
const imageUrlSchema = z
  .string()
  .max(2048)
  .transform((v) => v.trim())
  .refine((v) => {
    if (v === "") return true;
    if (/^\/(api\/)?uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) return true;
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, { message: "URL deve ser http(s) ou /api/uploads/..." });

const optionalImageUrl = z
  .preprocess((v) => (v === null || v === undefined ? "" : v), imageUrlSchema);

const fieldMode = z.enum(["required", "optional", "hidden"]).optional();

function nullableInt(min: number, max: number) {
  return z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().min(min).max(max).nullable(),
  ).optional();
}

export const settingsSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  logoUrl: optionalImageUrl,
  backgroundUrl: optionalImageUrl,
  primaryColor: z
    .string()
    .trim()
    .regex(HEX_COLOR, "Cor deve ser hex como #1a2b3c"),
  termsOfUse: z.string().max(8000),
  requireToken: z.boolean().optional(),
  singleDeviceByCpf: z.boolean().optional(),
  // Perfil padrão de acesso (sem token). null = usa GUEST_* do .env; 0 = sem limite.
  defaultDurationMin: nullableInt(1, 43200),
  defaultDownKbps: nullableInt(0, 10_000_000),
  defaultUpKbps: nullableInt(0, 10_000_000),
  defaultQuotaMB: nullableInt(0, 10_000_000),
  // Formulário do portal
  fieldName: fieldMode,
  fieldEmail: fieldMode,
  fieldPhone: fieldMode,
  fieldDocument: fieldMode,
  allowForeignDocument: z.boolean().optional(),
  rememberDeviceDays: z.coerce.number().int().min(0).max(365).optional(),
  // Verificação por código e login social
  verificationMode: z.enum(["none", "email", "sms"]).optional(),
  otpPreAuthMinutes: z.coerce.number().int().min(0).max(60).optional(),
  socialGoogle: z.boolean().optional(),
  socialMicrosoft: z.boolean().optional(),
  // LGPD
  marketingConsentMode: z.enum(["off", "optional"]).optional(),
  marketingConsentText: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  // Relatório por e-mail
  reportFrequency: z.enum(["off", "daily", "weekly"]).optional(),
  reportRecipients: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => v || null),
});

/** Sobrescritas de marca de um site. Campo vazio/nulo = herda da marca global. */
export const siteBrandingSchema = z.object({
  brandName: z.string().trim().max(120).nullish().transform((v) => v || null),
  logoUrl: optionalImageUrl.transform((v) => v || null),
  backgroundUrl: optionalImageUrl.transform((v) => v || null),
  primaryColor: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || HEX_COLOR.test(v), "Cor deve ser hex como #1a2b3c"),
  termsOfUse: z.string().max(8000).nullish().transform((v) => (v && v.trim() ? v : null)),
});

export type SiteBrandingInput = z.infer<typeof siteBrandingSchema>;

export type SettingsInput = z.infer<typeof settingsSchema>;
