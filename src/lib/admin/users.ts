import { z } from "zod";
import { prisma } from "../prisma";
import { ADMIN_ROLES } from "./rbac";
import { passwordPolicyError } from "./password";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, "Usuário: 3–40 caracteres (letras, números, . _ -)");

export const passwordSchema = z.string().superRefine((v, ctx) => {
  const err = passwordPolicyError(v);
  if (err) ctx.addIssue({ code: "custom", message: err });
});

export const createUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().max(120).optional().nullable(),
  role: z.enum(ADMIN_ROLES as unknown as [string, ...string[]]),
  password: passwordSchema,
});

export const updateUserSchema = z.object({
  name: z.string().trim().max(120).optional().nullable(),
  role: z.enum(ADMIN_ROLES as unknown as [string, ...string[]]).optional(),
  disabled: z.boolean().optional(),
  password: passwordSchema.optional(),
  resetTotp: z.boolean().optional(),
  unlock: z.boolean().optional(),
});

export const publicUserSelect = {
  id: true,
  username: true,
  name: true,
  role: true,
  totpEnabled: true,
  disabled: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Quantos admins ativos existiriam se `excludeId` deixasse de ser admin ativo. */
export async function activeAdminsExcluding(excludeId: string): Promise<number> {
  return prisma.adminUser.count({ where: { role: "admin", disabled: false, id: { not: excludeId } } });
}
