import { z } from "zod";
import { getGuestRegistrationSchema, type GuestRegistrationInput } from "../validators";
import type { Dictionary } from "../i18n/dictionaries";
import type { SystemSettings } from "../settings";
import type { AccessRequest, AuthMethod, GuestIdentity } from "./grantAccess";

export type ParsedForm =
  | { ok: true; data: GuestRegistrationInput }
  | { ok: false; status: number; body: Record<string, unknown> };

export function parseGuestForm(body: unknown, settings: SystemSettings, dict: Dictionary): ParsedForm {
  const parsed = getGuestRegistrationSchema(dict.validation, settings).safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    status: 400,
    body: { error: dict.portal.errInvalidData, issues: z.flattenError(parsed.error) },
  };
}

export function identityFrom(data: GuestRegistrationInput): GuestIdentity {
  return {
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
    cpf: data.cpf,
    documentType: data.documentType,
    document: data.document,
  };
}

export function accessRequestFrom(
  data: GuestRegistrationInput,
  authMethod: AuthMethod,
  meta: { userAgent?: string; ipAddress?: string },
): AccessRequest {
  return {
    identity: identityFrom(data),
    mac: data.mac,
    apMac: data.apMac,
    ssid: data.ssid,
    site: data.site,
    originalUrl: data.originalUrl,
    fingerprint: data.fingerprint ?? null,
    token: data.token,
    authMethod,
    ...meta,
  };
}
