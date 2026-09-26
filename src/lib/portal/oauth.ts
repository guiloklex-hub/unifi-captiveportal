import { createHash, randomBytes } from "crypto";
import { fetch } from "undici";
import { prisma } from "../prisma";
import { logger } from "../logger";
import type { SystemSettings } from "../settings";

/**
 * Login social via OAuth 2.0 / OpenID Connect (authorization code + PKCE).
 *
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT (padrão "common")
 *   PUBLIC_PORTAL_URL  — base HTTPS do portal; o redirect URI a cadastrar no
 *                        provedor é  ${PUBLIC_PORTAL_URL}/api/portal/oauth/callback
 *
 * O id_token é obtido diretamente do endpoint de token do provedor (canal
 * TLS servidor→servidor), então validamos iss/aud/exp/nonce sem verificar a
 * assinatura — permitido pela especificação OIDC (Core §3.1.3.7, item 6).
 *
 * Pré-requisito de rede: os domínios de login do provedor precisam estar no
 * walled garden (pre-authorization access) da UniFi — ver README.
 */

export type OAuthProvider = "google" | "microsoft";

type ProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  issuerOk: (iss: string) => boolean;
};

const LOGIN_TTL_MS = 10 * 60 * 1000;

function providerConfig(p: OAuthProvider): ProviderConfig | null {
  if (p === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId,
      clientSecret,
      issuerOk: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com",
    };
  }
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const tenant = process.env.MICROSOFT_TENANT || "common";
  return {
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    clientId,
    clientSecret,
    // Com tenant "common" o issuer traz o GUID do tenant do usuário.
    issuerOk: (iss) => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i.test(iss),
  };
}

export function portalPublicBase(): string | null {
  const base = process.env.PUBLIC_PORTAL_URL?.trim().replace(/\/+$/, "");
  return base && base.startsWith("https://") ? base : null;
}

export function redirectUri(): string | null {
  const base = portalPublicBase();
  return base ? `${base}/api/portal/oauth/callback` : null;
}

/** Provedores ligados no painel E com credenciais + URL pública HTTPS configuradas. */
export function availableProviders(settings: SystemSettings): OAuthProvider[] {
  if (!redirectUri()) return [];
  const out: OAuthProvider[] = [];
  if (settings.socialGoogle && providerConfig("google")) out.push("google");
  if (settings.socialMicrosoft && providerConfig("microsoft")) out.push("microsoft");
  return out;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export type OAuthContext = {
  mac: string;
  apMac: string | null;
  ssid: string | null;
  site: string | null;
  originalUrl: string | null;
};

export async function startOAuthLogin(provider: OAuthProvider, context: OAuthContext): Promise<string> {
  const cfg = providerConfig(provider);
  const redirect = redirectUri();
  if (!cfg || !redirect) throw new Error(`Login ${provider} não configurado`);

  const state = b64url(randomBytes(24));
  const codeVerifier = b64url(randomBytes(48));
  const nonce = b64url(randomBytes(16));
  await prisma.oAuthLogin.create({
    data: {
      id: state,
      provider,
      codeVerifier,
      nonce,
      context: JSON.stringify(context),
      expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
    },
  });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirect,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(codeVerifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${cfg.authUrl}?${params.toString()}`;
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("id_token malformado");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export type IdentityClaims = { name: string; email: string };

/** Valida as claims do id_token e extrai nome/e-mail. Lança em qualquer inconsistência. */
export function validateIdTokenClaims(
  provider: OAuthProvider,
  claims: Record<string, unknown>,
  expected: { clientId: string; nonce: string; issuerOk: (iss: string) => boolean },
): IdentityClaims {
  const aud = claims.aud;
  const audOk = aud === expected.clientId || (Array.isArray(aud) && aud.includes(expected.clientId));
  if (!audOk) throw new Error("aud inválido");
  if (typeof claims.iss !== "string" || !expected.issuerOk(claims.iss)) throw new Error("iss inválido");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("id_token expirado");
  if (claims.nonce !== expected.nonce) throw new Error("nonce inválido");

  const email = String(claims.email ?? (provider === "microsoft" ? claims.preferred_username ?? "" : "")).toLowerCase();
  if (!email.includes("@")) throw new Error("provedor não informou e-mail");
  if (provider === "google" && claims.email_verified !== true) throw new Error("e-mail Google não verificado");
  const name = String(claims.name ?? "").trim() || email.split("@")[0];
  return { name, email };
}

/**
 * Callback do provedor: troca o code, valida o id_token e devolve um ticket
 * de uso único para o portal concluir o cadastro.
 */
export async function completeOAuthLogin(
  state: string,
  code: string,
): Promise<{ ticket: string; context: OAuthContext }> {
  const login = await prisma.oAuthLogin.findUnique({ where: { id: state } });
  if (!login || login.ticket || login.expiresAt.getTime() <= Date.now()) throw new Error("state inválido ou expirado");
  const provider = login.provider as OAuthProvider;
  const cfg = providerConfig(provider);
  const redirect = redirectUri();
  if (!cfg || !redirect) throw new Error(`Login ${provider} não configurado`);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: login.codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`troca de código falhou (${res.status} ${body.error ?? ""})`);

  const identity = validateIdTokenClaims(provider, decodeJwtPayload(body.id_token), {
    clientId: cfg.clientId,
    nonce: login.nonce,
    issuerOk: cfg.issuerOk,
  });

  const ticket = b64url(randomBytes(24));
  await prisma.oAuthLogin.update({
    where: { id: state },
    data: { ...identity, ticket, expiresAt: new Date(Date.now() + LOGIN_TTL_MS) },
  });
  logger.info({ provider }, "social login completed");
  return { ticket, context: JSON.parse(login.context) as OAuthContext };
}

export type SocialIdentity = { provider: OAuthProvider; name: string; email: string };

/** Lê (sem consumir) a identidade de um ticket válido para este MAC. */
export async function peekSocialTicket(ticket: string, mac: string): Promise<SocialIdentity | null> {
  const login = await prisma.oAuthLogin.findUnique({ where: { ticket } });
  if (!login || login.usedAt || !login.email || login.expiresAt.getTime() <= Date.now()) return null;
  const ctx = JSON.parse(login.context) as OAuthContext;
  if (ctx.mac.toLowerCase() !== mac.toLowerCase()) return null;
  return { provider: login.provider as OAuthProvider, name: login.name ?? "", email: login.email };
}

/** Consome o ticket (uso único, atômico). */
export async function consumeSocialTicket(ticket: string, mac: string): Promise<SocialIdentity | null> {
  const identity = await peekSocialTicket(ticket, mac);
  if (!identity) return null;
  const marked = await prisma.oAuthLogin.updateMany({ where: { ticket, usedAt: null }, data: { usedAt: new Date() } });
  return marked.count === 1 ? identity : null;
}
