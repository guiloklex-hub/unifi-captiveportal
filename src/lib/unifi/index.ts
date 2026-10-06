import { logger } from "../logger";
import { getUniFiConfig, hasApiKey, hasPassword, type UniFiConfig } from "./config";
import {
  UniFiAuthError,
  UniFiClientError,
  UniFiNotConfiguredError,
  UniFiNotSupportedError,
  UniFiUnavailableError,
} from "./errors";
import { circuitState } from "./http";
import { containerNetworkHint } from "./netDiagnostics";
import {
  clearIntegrationCache,
  integrationAuthorizeGuest,
  integrationFindMacByIp,
  integrationListDevices,
  integrationListGuests,
  integrationListSites,
  integrationPrefix,
  integrationUnauthorizeGuest,
  integrationVersion,
} from "./integration";
import {
  clearLegacySession,
  probeVariant,
  ensureLegacySession,
  legacyAuthorizeGuest,
  legacyFindMacByIp,
  legacyListDevices,
  legacyListGuests,
  legacyListSites,
  legacySessionValid,
  legacyUnauthorizeGuest,
  legacyVersion,
  type LegacyAuth,
} from "./legacy";
import type { AuthorizeParams, UniFiDevice, UniFiGuest, UniFiSite, UniFiStrategy } from "./types";

/**
 * Cliente UniFi com múltiplas estratégias de conexão e fallback automático.
 *
 *   integration     API oficial (Network 9+) com API Key — recomendado
 *   legacy-apikey   API legada com API Key (UniFi OS)
 *   legacy-session  API legada com usuário/senha (todas as versões, inclusive Classic)
 *
 * `UNIFI_AUTH_MODE`:
 *   auto      (padrão) usa API Key quando configurada, com fallback para usuário/senha
 *   apikey    somente API Key
 *   password  somente usuário/senha (comportamento anterior)
 *
 * Estratégias que respondem "não suportado"/"credencial recusada" ficam marcadas
 * como indisponíveis por alguns minutos para não sondar a cada request.
 */

export { UniFiUnavailableError, UniFiClientError, UniFiAuthError, UniFiNotSupportedError, UniFiNotConfiguredError };
export type { UniFiGuest, UniFiSite, UniFiDevice, UniFiStrategy, AuthorizeParams };

const UNSUPPORTED_TTL_MS = 10 * 60 * 1000;
const SITE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Op = "write" | "stats" | "meta";

type FacadeState = {
  configVersion: string;
  unavailableUntil: Partial<Record<UniFiStrategy, number>>;
  lastUsed: Partial<Record<Op, UniFiStrategy>>;
};

const g = globalThis as unknown as { __unifiFacade?: FacadeState };

function facade(cfg: UniFiConfig): FacadeState {
  const cur = g.__unifiFacade;
  if (!cur || cur.configVersion !== cfg.version) {
    g.__unifiFacade = { configVersion: cfg.version, unavailableUntil: {}, lastUsed: {} };
  }
  return g.__unifiFacade!;
}

/** Estratégias configuradas, na ordem de preferência para cada tipo de operação. */
export function strategiesFor(cfg: UniFiConfig, op: Op): UniFiStrategy[] {
  const key = hasApiKey(cfg) && cfg.authMode !== "password";
  const pass = hasPassword(cfg) && cfg.authMode !== "apikey";
  const order: UniFiStrategy[] =
    op === "stats"
      ? // Contadores de tráfego só existem na API legada.
        ["legacy-apikey", "legacy-session", "integration"]
      : ["integration", "legacy-apikey", "legacy-session"];
  return order.filter((s) => (s === "legacy-session" ? pass : key));
}

function resolveSite(cfg: UniFiConfig, site?: string | null): string {
  const s = (site ?? "").trim();
  if (s.length === 0) return cfg.site;
  if (!SITE_NAME_RE.test(s)) throw new UniFiClientError(400, `Site UniFi inválido: ${s.slice(0, 64)}`);
  return s;
}

function legacyAuthOf(strategy: UniFiStrategy): LegacyAuth {
  return strategy === "legacy-apikey" ? "apikey" : "session";
}

/** Erros que indicam "tente a próxima estratégia" (não um problema do payload nem da rede). */
function isFallbackError(err: unknown): boolean {
  return err instanceof UniFiNotSupportedError || err instanceof UniFiAuthError;
}

async function run<T>(op: Op, fn: (cfg: UniFiConfig, strategy: UniFiStrategy) => Promise<T>): Promise<T> {
  const cfg = await getUniFiConfig();
  if (!cfg.url) throw new UniFiNotConfiguredError("UNIFI_URL não configurada");
  const st = facade(cfg);
  const all = strategiesFor(cfg, op);
  if (all.length === 0) throw new UniFiNotConfiguredError();

  const now = Date.now();
  const available = all.filter((s) => (st.unavailableUntil[s] ?? 0) <= now);
  // Todas marcadas como indisponíveis: tenta de novo em vez de falhar sem tentar.
  const candidates = available.length > 0 ? available : all;

  let lastErr: unknown;
  for (const strategy of candidates) {
    try {
      const result = await fn(cfg, strategy);
      if (st.lastUsed[op] !== strategy) {
        logger.info({ op, strategy }, "UniFi strategy selected");
        st.lastUsed[op] = strategy;
      }
      delete st.unavailableUntil[strategy];
      return result;
    } catch (err) {
      lastErr = err;
      if (!isFallbackError(err)) throw err;
      st.unavailableUntil[strategy] = Date.now() + UNSUPPORTED_TTL_MS;
      logger.warn({ op, strategy, err: (err as Error).message }, "UniFi strategy unavailable — trying next");
    }
  }
  throw lastErr;
}

// ─── API pública ────────────────────────────────────────────────────────────

export type AuthorizeGuestOptions = AuthorizeParams & { site?: string | null };

export async function authorizeGuest(opts: AuthorizeGuestOptions): Promise<void> {
  await run("write", (cfg, strategy) => {
    const site = resolveSite(cfg, opts.site);
    return strategy === "integration"
      ? integrationAuthorizeGuest(cfg, site, opts)
      : legacyAuthorizeGuest(cfg, site, opts, legacyAuthOf(strategy));
  });
}

export async function unauthorizeGuest(mac: string, siteOverride?: string | null): Promise<void> {
  await run("write", (cfg, strategy) => {
    const site = resolveSite(cfg, siteOverride);
    return strategy === "integration"
      ? integrationUnauthorizeGuest(cfg, site, mac)
      : legacyUnauthorizeGuest(cfg, site, mac, legacyAuthOf(strategy));
  });
}

export async function listActiveGuests(siteOverride?: string | null): Promise<UniFiGuest[]> {
  return run("stats", (cfg, strategy) => {
    const site = resolveSite(cfg, siteOverride);
    return strategy === "integration"
      ? integrationListGuests(cfg, site)
      : legacyListGuests(cfg, site, legacyAuthOf(strategy));
  });
}

/**
 * MAC do cliente conectado com este IP (ou null). Usado quando o portal é aberto
 * sem o `?id=<mac>` da controladora — ex.: QR code de token aberto pela câmera.
 */
export async function findClientMacByIp(ip: string, siteOverride?: string | null): Promise<string | null> {
  return run("meta", (cfg, strategy) => {
    const site = resolveSite(cfg, siteOverride);
    return strategy === "integration"
      ? integrationFindMacByIp(cfg, site, ip)
      : legacyFindMacByIp(cfg, site, ip, legacyAuthOf(strategy));
  });
}

export async function listSites(): Promise<UniFiSite[]> {
  return run("meta", (cfg, strategy) =>
    strategy === "integration" ? integrationListSites(cfg) : legacyListSites(cfg, legacyAuthOf(strategy)),
  );
}

export async function listDevices(siteOverride?: string | null): Promise<UniFiDevice[]> {
  return run("meta", (cfg, strategy) => {
    const site = resolveSite(cfg, siteOverride);
    return strategy === "integration"
      ? integrationListDevices(cfg, site)
      : legacyListDevices(cfg, site, legacyAuthOf(strategy));
  });
}

/**
 * Guest efetivamente online e autorizado. `/stat/guest` também lista sessões
 * encerradas (`expired`) e algumas versões omitem `authorized` — só descartamos
 * quando vem explicitamente `false`.
 */
export function isGuestOnline(g: UniFiGuest): boolean {
  return g.authorized !== false && g.expired !== true;
}

export function clearUniFiSession(): void {
  clearLegacySession();
  clearIntegrationCache();
  g.__unifiFacade = undefined;
}

// ─── Saúde e diagnóstico ────────────────────────────────────────────────────

export type UniFiHealth = {
  status: "ok" | "degraded" | "down";
  circuitOpenUntil: number | null;
  cachedSessionValid: boolean;
  failures: number;
  strategy?: UniFiStrategy | null;
};

export async function checkUnifiHealth(): Promise<UniFiHealth> {
  const cfg = await getUniFiConfig();
  const circuit = circuitState();
  const cachedSessionValid = legacySessionValid(cfg);
  if (circuit.openUntil) {
    return { status: "down", circuitOpenUntil: circuit.openUntil, cachedSessionValid, failures: circuit.failures };
  }

  try {
    const strategy = await Promise.race([
      run("write", async (c, s) => {
        if (s === "integration") await integrationPrefix(c);
        else if (s === "legacy-session") await ensureLegacySession(c);
        else await legacyListSites(c, "apikey");
        return s;
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("healthz timeout")), 3_000)),
    ]);
    return { status: "ok", circuitOpenUntil: null, cachedSessionValid: legacySessionValid(cfg), failures: circuit.failures, strategy };
  } catch {
    return { status: "degraded", circuitOpenUntil: null, cachedSessionValid, failures: circuitState().failures, strategy: null };
  }
}

export type StrategyReport = {
  strategy: UniFiStrategy;
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
};

export type UniFiDiagnostics = {
  url: string;
  site: string;
  authMode: UniFiConfig["authMode"];
  source: UniFiConfig["source"];
  insecureTls: boolean;
  variant: "unifi-os" | "classic" | "unknown";
  version: string | null;
  strategies: StrategyReport[];
  /** Estratégia que será usada para autorizar guests. */
  activeStrategy: UniFiStrategy | null;
  sites: UniFiSite[];
  circuit: { failures: number; openUntil: number | null };
  /** Possível causa quando a controladora não respondeu (ex.: conflito com a rede do Docker). */
  hint: string | null;
};

function describe(err: unknown): string {
  if (err instanceof UniFiUnavailableError) return `Controladora inalcançável: ${err.message}`;
  if (err instanceof UniFiAuthError) return err.message;
  if (err instanceof UniFiNotSupportedError) return `Não suportado nesta controladora: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function probe(cfg: UniFiConfig, strategy: UniFiStrategy): Promise<{ sites: UniFiSite[]; version: string | null }> {
  if (strategy === "integration") {
    const sites = await integrationListSites(cfg);
    return { sites, version: await integrationVersion(cfg) };
  }
  const auth = legacyAuthOf(strategy);
  const sites = await legacyListSites(cfg, auth);
  const version = await legacyVersion(cfg, sites.find((s) => s.name === cfg.site)?.name ?? cfg.site, auth).catch(
    () => null,
  );
  return { sites, version };
}

/**
 * Testa cada estratégia isoladamente (sem fallback) — usado pela tela
 * "Conexão UniFi" do painel. Aceita uma configuração ainda não salva.
 */
export async function diagnoseUniFi(override?: UniFiConfig): Promise<UniFiDiagnostics> {
  const cfg = override ?? (await getUniFiConfig());
  const isUnifiOS = cfg.url ? await probeVariant(cfg) : null;
  const variant: UniFiDiagnostics["variant"] = isUnifiOS === null ? "unknown" : isUnifiOS ? "unifi-os" : "classic";

  const all: UniFiStrategy[] = ["integration", "legacy-apikey", "legacy-session"];
  const configured = new Set(strategiesFor(cfg, "write"));
  const reports: StrategyReport[] = [];
  let version: string | null = null;
  let sites: UniFiSite[] = [];

  for (const strategy of all) {
    if (!configured.has(strategy) || !cfg.url) {
      reports.push({ strategy, configured: false, ok: false, latencyMs: null, error: null });
      continue;
    }
    if (strategy === "legacy-apikey" && variant === "classic") {
      reports.push({
        strategy,
        configured: true,
        ok: false,
        latencyMs: null,
        error: "API Key na API legada só existe no UniFi OS",
      });
      continue;
    }
    const started = Date.now();
    try {
      const r = await probe(cfg, strategy);
      reports.push({ strategy, configured: true, ok: true, latencyMs: Date.now() - started, error: null });
      version ??= r.version;
      if (sites.length === 0) sites = r.sites;
    } catch (err) {
      reports.push({ strategy, configured: true, ok: false, latencyMs: Date.now() - started, error: describe(err) });
    }
  }

  const activeStrategy = strategiesFor(cfg, "write").find((s) => reports.find((r) => r.strategy === s)?.ok) ?? null;

  return {
    url: cfg.url,
    site: cfg.site,
    authMode: cfg.authMode,
    source: cfg.source,
    insecureTls: cfg.insecureTls,
    variant,
    version,
    strategies: reports,
    activeStrategy,
    sites,
    circuit: circuitState(),
    hint: cfg.url && variant === "unknown" && !activeStrategy ? containerNetworkHint(cfg.url) : null,
  };
}
