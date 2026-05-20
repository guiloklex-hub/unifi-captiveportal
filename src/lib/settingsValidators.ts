import { z } from "zod";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * Aceita string vazia (remove), caminho relativo `/uploads/...` (upload local)
 * ou URL absoluta http(s). Rejeita `javascript:`, `data:`, `vbscript:` e qualquer
 * outro scheme — defesa contra XSS via `<img src>` injetado pelo admin.
 */
const imageUrlSchema = z
  .string()
  .max(2048)
  .transform((v) => v.trim())
  .refine((v) => {
    if (v === "") return true;
    if (v.startsWith("/uploads/")) return true;
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, { message: "URL deve ser http(s) ou /uploads/..." });

const optionalImageUrl = z
  .preprocess((v) => (v === null || v === undefined ? "" : v), imageUrlSchema);

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
});

export type SettingsInput = z.infer<typeof settingsSchema>;
