import { prisma } from "../prisma";
import { logger } from "../logger";
import { authorizeGuest, UniFiClientError } from "../unifi";
import { findActiveCpfOnOtherDevice } from "../cpfLock";
import { sanitizeGuestRedirect } from "../safeRedirect";
import { defaultGuestPolicy, type SystemSettings } from "../settings";
import { visitorKeyOf } from "../validators";
import { findBlockingRule } from "./accessRules";
import type { Dictionary } from "../i18n/dictionaries";
import {
  releaseTokenUse,
  reserveTokenUse,
  TokenExhaustedError,
  TokenExpiredError,
  TokenInvalidError,
  TokenRevokedError,
  TokenUnavailableError,
  validateTokenForUse,
} from "../tokens";

/**
 * Pipeline único de liberação de acesso do guest, usado por todas as formas de
 * entrada (formulário, convidado recorrente, código de verificação, login social):
 *
 *   token (se exigido) → bloqueio de 1 dispositivo por CPF → UniFi → registro.
 *
 * Se a UniFi falhar depois de reservar um uso de token, o uso é devolvido.
 */

export type AuthMethod =
  | "form"
  | "token"
  | "returning"
  | "otp-email"
  | "otp-sms"
  | "google"
  | "microsoft"
  | "allowlist"
  | "admin";

export type GuestIdentity = {
  fullName: string;
  email: string;
  phone: string;
  cpf: string;
  documentType: string | null;
  document: string | null;
};

export type AccessRequest = {
  identity: GuestIdentity;
  mac: string;
  apMac: string | null;
  ssid: string | null;
  site: string | null;
  originalUrl: string | null;
  fingerprint: string | null;
  userAgent?: string;
  ipAddress?: string;
  token?: string | null;
  authMethod: AuthMethod;
  /**
   * Liberação decidida pelo admin (lista de liberação / "liberar dispositivo"):
   * ignora token e bloqueio de CPF e usa a duração informada.
   */
  adminGrant?: { minutes?: number | null };
};

export type AccessResult =
  | { ok: true; id: number | null; redirect: string | null }
  | { ok: false; status: number; error: string };

export function brtDate(d = new Date()): string {
  // YYYY-MM-DD em BRT — sem isso, autorizações perto da meia-noite criariam
  // dois registros no mesmo dia (toISOString usa UTC, 3h de diferença).
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function grantGuestAccess(
  req: AccessRequest,
  settings: SystemSettings,
  dict: Dictionary,
): Promise<AccessResult> {
  const mac = req.mac.toLowerCase();
  const authDate = brtDate();
  const log = logger.child({ mac, ssid: req.ssid, ip: req.ipAddress, method: req.authMethod });

  const policy = defaultGuestPolicy(settings);
  let { minutes } = policy;
  let downKbps = policy.downKbps;
  let upKbps = policy.upKbps;
  let bytesQuotaMB = policy.bytesQuotaMB;
  let site = req.site;
  let authMethod: AuthMethod = req.authMethod;

  // ── Bloqueios definidos pelo admin ───────────────────────────────────────
  const block = await findBlockingRule({
    mac,
    cpf: req.identity.cpf,
    email: req.identity.email,
    document: req.identity.document,
  });
  if (block) {
    log.info({ ruleId: block.id, matchType: block.matchType }, "Guest blocked by access rule");
    return { ok: false, status: 403, error: dict.portal.errBlocked };
  }
  if (req.adminGrant?.minutes) minutes = req.adminGrant.minutes;

  // ── Token ────────────────────────────────────────────────────────────────
  let tokenId: string | null = null;
  let tokenReserved = false;
  if (settings.requireToken && !req.adminGrant) {
    try {
      const token = await validateTokenForUse(req.token ?? "");
      tokenId = token.id;
      minutes = token.durationMin;
      downKbps = token.downKbps ?? undefined;
      upKbps = token.upKbps ?? undefined;
      bytesQuotaMB = token.bytesQuotaMB ?? undefined;
      // Token vinculado a site específico tem precedência sobre o site da URL UniFi.
      if (token.site && token.site.trim()) site = token.site;
      if (authMethod === "form") authMethod = "token";

      // Sinal de possível reuso fraudulento: mesmo MAC com fingerprint diferente
      // de uso anterior do mesmo token. Apenas registra em log.
      if (req.fingerprint) {
        const priorWithDiffFp = await prisma.guestRegistration.findFirst({
          where: {
            tokenId: token.id,
            macAddress: mac,
            AND: [{ fingerprint: { not: null } }, { fingerprint: { not: req.fingerprint } }],
          },
          select: { id: true },
        });
        if (priorWithDiffFp) {
          log.warn({ tokenId: token.id }, "Fingerprint mismatch on same MAC+token — possible MAC spoofing");
        }
      }

      // Idempotência: o mesmo MAC já consumiu este token hoje (refresh, nova
      // tentativa) → não consome outro uso, só re-autoriza.
      const existing = await prisma.guestRegistration.findUnique({
        where: { macAddress_authDate: { macAddress: mac, authDate } },
        select: { tokenId: true },
      });
      if (existing?.tokenId !== token.id) {
        await reserveTokenUse(token.id);
        tokenReserved = true;
        await prisma.accessToken
          .updateMany({ where: { id: token.id, firstUsedAt: null }, data: { firstUsedAt: new Date() } })
          .catch(() => undefined);
      } else {
        log.info({ tokenId: token.id }, "Token reuse by same MAC/day — skipping reserve");
      }
    } catch (err) {
      const map = new Map<string, string>([
        [TokenInvalidError.name, dict.validation.valTokenInvalid],
        [TokenExpiredError.name, dict.validation.valTokenExpired],
        [TokenRevokedError.name, dict.validation.valTokenRevoked],
        [TokenExhaustedError.name, dict.validation.valTokenExhausted],
        [TokenUnavailableError.name, dict.validation.valTokenExhausted],
      ]);
      if (err instanceof Error && map.has(err.name)) {
        log.info({ tokenError: err.name }, "Token validation failed");
        return { ok: false, status: 400, error: map.get(err.name)! };
      }
      throw err;
    }
  }

  // ── 1 dispositivo por CPF ────────────────────────────────────────────────
  // Só com CPF informado e sem token (o admin já controla o acesso pelo token).
  if (settings.singleDeviceByCpf && !tokenReserved && !req.adminGrant && req.identity.cpf) {
    const conflict = await findActiveCpfOnOtherDevice(req.identity.cpf, mac);
    if (conflict) {
      log.info({ conflictMac: conflict.macAddress, conflictId: conflict.id }, "CPF blocked: active session on other MAC");
      return { ok: false, status: 409, error: dict.validation.valCpfAlreadyActive };
    }
  }

  // ── UniFi ────────────────────────────────────────────────────────────────
  try {
    await authorizeGuest({ mac, minutes, downKbps, upKbps, bytesQuotaMB, apMac: req.apMac, site });
  } catch (err) {
    if (tokenReserved && tokenId) {
      await releaseTokenUse(tokenId).catch((e) =>
        log.error({ err: (e as Error).message }, "Failed to release token use after UniFi failure"),
      );
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    // Qualquer erro que não seja "payload recusado" é indisponibilidade do nosso
    // lado (rede, circuito aberto, credencial/configuração inválida).
    const isDown = !(err instanceof UniFiClientError);
    log.error({ err: message, isDown }, "UniFi authorize failed");
    // Detalhes da controladora (paths, respostas) ficam só no log — não vazam ao guest.
    return {
      ok: false,
      status: 502,
      error: isDown ? dict.portal.errServiceUnavailable : dict.portal.errAuthorizeFailed,
    };
  }

  // ── Registro (idempotente por MAC + dia) ─────────────────────────────────
  const redirect = sanitizeGuestRedirect(process.env.PORTAL_SUCCESS_URL ?? req.originalUrl);
  const id = req.identity;
  const data = {
    fullName: id.fullName,
    email: id.email,
    phone: id.phone,
    cpf: id.cpf,
    documentType: id.documentType,
    document: id.document,
    visitorKey: visitorKeyOf({ cpf: id.cpf, document: id.document, email: id.email, mac }),
    authMethod,
    apMac: req.apMac,
    ssid: req.ssid,
    site,
    userAgent: req.userAgent,
    ipAddress: req.ipAddress,
    fingerprint: req.fingerprint,
    durationMin: minutes,
    downKbps,
    upKbps,
    bytesQuotaMB,
    tokenId,
  };
  try {
    const record = await prisma.guestRegistration.upsert({
      where: { macAddress_authDate: { macAddress: mac, authDate } },
      create: { ...data, macAddress: mac, authDate },
      update: { ...data, authorizedAt: new Date(), revokedAt: null },
    });
    log.info({ id: record.id, tokenId }, "Guest authorized");
    return { ok: true, id: record.id, redirect };
  } catch (err) {
    // Autorizou na UniFi mas falhou no banco: não bloqueia o guest; fica no log.
    log.error({ err: (err as Error).message }, "DB persist failed after UniFi authorize");
    return { ok: true, id: null, redirect };
  }
}
