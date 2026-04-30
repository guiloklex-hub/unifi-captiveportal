import { z } from "zod";

export const createTokenSchema = z.object({
  description: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  durationMin: z.coerce.number().int().min(1).max(43200),
  downKbps: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  upKbps: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  bytesQuotaMB: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  maxUses: z.coerce.number().int().min(1).max(1000),
  expiresAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), {
    message: "Data de expiração deve ser futura",
  }),
  site: z.string().trim().min(1).max(64).optional().or(z.literal("").transform(() => undefined)),
});

export const extendTokenSchema = z.object({
  expiresAt: z.coerce.date().optional(),
  addUses: z.coerce.number().int().positive().max(1000).optional(),
}).refine((v) => v.expiresAt !== undefined || v.addUses !== undefined, {
  message: "Informe ao menos um campo: expiresAt ou addUses",
});

export type CreateTokenInput = z.infer<typeof createTokenSchema>;
export type ExtendTokenInput = z.infer<typeof extendTokenSchema>;
