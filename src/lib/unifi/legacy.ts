import { logger } from "../logger";
import type { UniFiConfig } from "./config";
import { UniFiAuthError, UniFiClientError, UniFiNotSupportedError } from "./errors";
import { unifiHttp, type HttpResponse } from "./http";
import type { AuthorizeParams, UniFiDevice, UniFiGuest, UniFiSite } from "./types";

/**
 * API "legada" da UniFi Network (`/api/s/<site>/...`) — não documentada
 * oficialmente, mas presente em todas as versões (5.x → 10.x) e em ambas as
 * variantes:
 *   - Classic / self-hosted (porta 8443): `/api/login` + `/api/s/...`
 *   - UniFi OS (UDM, UCG, Cloud Key Gen2+, UniFi OS Server): `/api/auth/login` +
 *     `/proxy/network/api/s/...`
 *
 * Duas formas de autenticação:
 *   - "session": usuário/senha → cookie + CSRF (todas as versões);
 *   - "apikey":  header `X-API-KEY` (somente UniFi OS com Network 9+).
 */

export type LegacyAuth = "session" | "apikey";

type Session = {
  cookieHeader: string;
  csrfToken?: string;
  expiresAt: number;
  isUnifiOS: boolean;
};

type LegacyState = {
  configVersion: string;
  session: Session | null;
  loginPromise: Promise<Session> | null;
  isUnifiOS: boolean | null;
};

const SESSION_TTL_MS = 55 * 60 * 1000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const g = globalThis as unknown as { __unifiLegacy?: LegacyState; __unifiLegacyDiag?: LegacyState };

function state(cfg: UniFiConfig): LegacyState {
  const slot = cfg.diagnostic ? "__unifiLegacyDiag" : "__unifiLegacy";
  const cur = g[slot];
  if (!cur || cur.configVersion !== cfg.version) {
    g[slot] = { configVersion: cfg.version, session: null, loginPromise: null, isUnifiOS: null };
  }
  return g[slot]!;
}

export function clearLegacySession(): void {
  g.__unifiLegacy = undefined;
  g.__unifiLegacyDiag = undefined;
}

export function legacySessionValid(cfg: UniFiConfig): boolean {
  const s = state(cfg).session;
  return Boolean(s && s.expiresAt > Date.now());
}

/**
 * Detecta UniFi OS vs Classic. UniFi OS devolve `X-CSRF-Token` no GET raiz;
 * Classic não. Retorna `null` quando o probe falha (nada é memorizado).
 */
export async function probeVariant(cfg: UniFiConfig): Promise<boolean | null> {
  const st = state(cfg);
  if (st.isUnifiOS !== null) return st.isUnifiOS;
  try {
    const res = await unifiHttp(`${cfg.url}/`, {
      insecureTls: cfg.insecureTls,
      noCircuit: cfg.diagnostic,
      timeoutMs: 5_000,
      headers: { accept: "text/html,application/json" },
    });
    st.isUnifiOS = res.headers.get("x-csrf-token") !== null;
    logger.debug({ isUnifiOS: st.isUnifiOS }, "UniFi variant detected");
    return st.isUnifiOS;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "UniFi variant probe failed");
    return null;
  }
}

/** Como `probeVariant`, assumindo Classic quando o probe falha (o login tenta ambos). */
export async function detectIsUnifiOS(cfg: UniFiConfig): Promise<boolean> {
  return (await probeVariant(cfg)) ?? false;
}

function cookieHeaderFrom(res: HttpResponse): string {
  const list = res.headers.getSetCookie?.() ?? [];
  const raw = list.length > 0 ? list : (res.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/);
  return raw
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function doLogin(cfg: UniFiConfig): Promise<Session> {
  if (!cfg.username || !cfg.password) {
    throw new UniFiAuthError("Usuário/senha da controladora não configurados");
  }
  const st = state(cfg);
  const isUnifiOS = await detectIsUnifiOS(cfg);
  const primary = isUnifiOS ? "/api/auth/login" : "/api/login";
  const fallback = isUnifiOS ? "/api/login" : "/api/auth/login";

  const attempt = (endpoint: string) =>
    unifiHttp(`${cfg.url}${endpoint}`, {
      method: "POST",
      insecureTls: cfg.insecureTls,
      noCircuit: cfg.diagnostic,
      headers: {
        "User-Agent": BROWSER_UA,
        Origin: cfg.url,
        Referer: `${cfg.url}/manage/account/login`,
      },
      body: { username: cfg.username, password: cfg.password, remember: true },
    });

  let res = await attempt(primary);
  let usedIsUnifiOS = isUnifiOS;
  // Variante errada detectada → tenta o outro endpoint.
  if (res.status === 404) {
    logger.warn({ primary, fallback }, "UniFi primary login endpoint 404, trying fallback");
    res = await attempt(fallback);
    usedIsUnifiOS = !isUnifiOS;
    if (res.status < 300) st.isUnifiOS = usedIsUnifiOS;
  }

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new UniFiAuthError(`Login recusado pela controladora (${res.status}). Verifique usuário/senha e MFA.`);
  }
  if (res.status >= 300) {
    throw new UniFiClientError(res.status, `UniFi login falhou (${res.status}): ${res.text.slice(0, 200)}`);
  }

  const session: Session = {
    cookieHeader: cookieHeaderFrom(res),
    csrfToken: res.headers.get("x-csrf-token") ?? res.headers.get("x-updated-csrf-token") ?? undefined,
    expiresAt: Date.now() + SESSION_TTL_MS,
    isUnifiOS: usedIsUnifiOS,
  };
  st.session = session;
  logger.info({ isUnifiOS: usedIsUnifiOS, hasCsrf: !!session.csrfToken }, "UniFi login ok");
  return session;
}

/** Login com mutex: requests simultâneos aguardam a mesma promise. */
function login(cfg: UniFiConfig): Promise<Session> {
  const st = state(cfg);
  if (st.loginPromise) return st.loginPromise;
  st.loginPromise = doLogin(cfg).finally(() => {
    st.loginPromise = null;
  });
  return st.loginPromise;
}

export async function ensureLegacySession(cfg: UniFiConfig): Promise<Session> {
  const s = state(cfg).session;
  if (s && s.expiresAt > Date.now()) return s;
  return login(cfg);
}

type LegacyInit = { method?: "GET" | "POST"; body?: unknown };

async function requestOnce(
  cfg: UniFiConfig,
  path: string,
  init: LegacyInit,
  auth: LegacyAuth,
  session: Session | null,
): Promise<HttpResponse> {
  const headers: Record<string, string> = { "User-Agent": BROWSER_UA, Origin: cfg.url };
  let prefix: string;
  if (auth === "apikey") {
    headers["X-API-KEY"] = cfg.apiKey ?? "";
    // API Key só existe no UniFi OS, onde a Network fica atrás de /proxy/network.
    prefix = "/proxy/network";
  } else {
    headers.cookie = session!.cookieHeader;
    if (session!.csrfToken) headers["x-csrf-token"] = session!.csrfToken;
    prefix = session!.isUnifiOS ? "/proxy/network" : "";
  }

  const res = await unifiHttp(`${cfg.url}${prefix}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    insecureTls: cfg.insecureTls,
    noCircuit: cfg.diagnostic,
  });

  // CSRF rotativo (UniFi OS)
  const newCsrf = res.headers.get("x-updated-csrf-token");
  const st = state(cfg);
  if (auth === "session" && newCsrf && st.session) st.session.csrfToken = newCsrf;
  return res;
}

/**
 * Request na API legada. Em "session", faz relogin transparente em 401/403 ou
 * quando a controladora devolve HTML com status 200 (sessão invalidada).
 */
export async function legacyRequest<T>(
  cfg: UniFiConfig,
  path: string,
  init: LegacyInit = {},
  auth: LegacyAuth = "session",
): Promise<T> {
  if (auth === "apikey") {
    if (!cfg.apiKey) throw new UniFiAuthError("API Key não configurada");
    if ((await probeVariant(cfg)) === false) {
      throw new UniFiNotSupportedError("API Key na API legada só existe no UniFi OS");
    }
  }

  let session = auth === "session" ? await ensureLegacySession(cfg) : null;
  let res = await requestOnce(cfg, path, init, auth, session);

  const sessionLost = res.status === 401 || res.status === 403 || (res.status < 300 && res.json === undefined && res.status !== 204);
  if (auth === "session" && sessionLost) {
    logger.warn({ path, status: res.status }, "UniFi session invalid — relogin");
    state(cfg).session = null;
    session = await login(cfg);
    res = await requestOnce(cfg, path, init, auth, session);
  }

  if (res.status === 401 || res.status === 403) {
    throw new UniFiAuthError(
      auth === "apikey"
        ? `API Key recusada na API legada (${res.status})`
        : `Acesso negado pela controladora (${res.status})`,
    );
  }
  if (res.status === 404) throw new UniFiNotSupportedError(`Endpoint legado inexistente: ${path}`);
  if (res.status >= 300) {
    throw new UniFiClientError(res.status, `UniFi ${path} falhou (${res.status}): ${res.text.slice(0, 200)}`);
  }
  if (res.status !== 204 && res.json === undefined) {
    // Com API Key não há sessão para renovar: HTML aqui = endpoint não suportado.
    throw new UniFiNotSupportedError(`Resposta não-JSON da API legada em ${path}`);
  }
  return res.json as T;
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function legacyAuthorizeGuest(
  cfg: UniFiConfig,
  site: string,
  p: AuthorizeParams,
  auth: LegacyAuth,
): Promise<void> {
  const payload: Record<string, unknown> = {
    cmd: "authorize-guest",
    mac: p.mac.toLowerCase(),
    minutes: p.minutes,
  };
  // `0` é inválido como limite (sinônimo de ausente): só envia limites reais.
  if (typeof p.upKbps === "number" && p.upKbps > 0) payload.up = p.upKbps;
  if (typeof p.downKbps === "number" && p.downKbps > 0) payload.down = p.downKbps;
  if (typeof p.bytesQuotaMB === "number" && p.bytesQuotaMB > 0) payload.bytes = p.bytesQuotaMB;
  if (p.apMac) payload.ap_mac = p.apMac.toLowerCase();

  await legacyRequest(cfg, `/api/s/${site}/cmd/stamgr`, { method: "POST", body: payload }, auth);
}

export async function legacyUnauthorizeGuest(
  cfg: UniFiConfig,
  site: string,
  mac: string,
  auth: LegacyAuth,
): Promise<void> {
  await legacyRequest(
    cfg,
    `/api/s/${site}/cmd/stamgr`,
    { method: "POST", body: { cmd: "unauthorize-guest", mac: mac.toLowerCase() } },
    auth,
  );
}

export async function legacyListGuests(cfg: UniFiConfig, site: string, auth: LegacyAuth): Promise<UniFiGuest[]> {
  const res = await legacyRequest<{ data?: UniFiGuest[] }>(cfg, `/api/s/${site}/stat/guest`, {}, auth);
  return res.data ?? [];
}

export async function legacyListSites(cfg: UniFiConfig, auth: LegacyAuth): Promise<UniFiSite[]> {
  const res = await legacyRequest<{ data?: { name: string; desc?: string; _id?: string }[] }>(
    cfg,
    "/api/self/sites",
    {},
    auth,
  );
  return (res.data ?? []).map((s) => ({ name: s.name, description: s.desc ?? s.name, id: s._id ?? null }));
}

export async function legacyVersion(cfg: UniFiConfig, site: string, auth: LegacyAuth): Promise<string | null> {
  const res = await legacyRequest<{ data?: { version?: string }[] }>(cfg, `/api/s/${site}/stat/sysinfo`, {}, auth);
  return res.data?.[0]?.version ?? null;
}

export async function legacyListDevices(cfg: UniFiConfig, site: string, auth: LegacyAuth): Promise<UniFiDevice[]> {
  const res = await legacyRequest<{ data?: { mac: string; name?: string; model?: string; type?: string }[] }>(
    cfg,
    `/api/s/${site}/stat/device-basic`,
    {},
    auth,
  );
  return (res.data ?? []).map((d) => ({
    mac: d.mac.toLowerCase(),
    name: d.name || d.mac,
    model: d.model ?? null,
  }));
}
