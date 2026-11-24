import { logger } from "../logger";
import type { UniFiConfig } from "./config";
import {
  UniFiAuthError,
  UniFiClientError,
  UniFiClientNotFoundError,
  UniFiNotSupportedError,
  UniFiUnavailableError,
} from "./errors";
import { unifiHttp } from "./http";
import type { AuthorizeParams, UniFiDevice, UniFiGuest, UniFiSite } from "./types";

/**
 * API oficial "UniFi Network Integration API" (Network 9.x+), autenticada por
 * API Key (header `X-API-KEY`) — sem usuário/senha, sessão, cookie ou CSRF.
 *
 * Criação da chave: UniFi Network → Settings → Control Plane → Integrations
 * (ou "Integrations" no UniFi OS) → Create API Key.
 *
 * Base: `/proxy/network/integration/v1` (UniFi OS) — também é testado
 * `/integration/v1` para instalações que exponham a API sem o proxy do UniFi OS.
 *
 * Operações usadas (conferidas com a especificação oficial, Network 9.1 → 11.0):
 *   GET  /v1/info
 *   GET  /v1/sites                                      (id ↔ internalReference = nome curto legado)
 *   GET  /v1/sites/{siteId}/clients?filter=macAddress.eq('..')
 *   GET  /v1/sites/{siteId}/clients?filter=access.type.eq('GUEST')
 *   GET  /v1/sites/{siteId}/clients/{clientId}          (access.authorization.usage → bytes do guest)
 *   POST /v1/sites/{siteId}/clients/{clientId}/actions  { action: AUTHORIZE_GUEST_ACCESS | UNAUTHORIZE_GUEST_ACCESS }
 *   GET  /v1/sites/{siteId}/devices
 */

const PREFIX_CANDIDATES = ["/proxy/network/integration", "/integration"];
const SITE_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;
/**
 * Tempo máximo esperando o cliente recém-associado aparecer na API oficial.
 * A controladora pode levar dezenas de segundos para listar um guest ainda não
 * autorizado; o formulário costuma ser enviado antes disso.
 */
const DEFAULT_CLIENT_WAIT_MS = 12_000;
const CLIENT_WAIT_STEPS_MS = [1_000, 2_000, 3_000];
/** Detalhes de clientes consultados em paralelo ao ler o tráfego dos guests. */
const DETAIL_CONCURRENCY = 5;
const GUEST_FILTER = encodeURIComponent("access.type.eq('GUEST')");

/**
 * Faixas aceitas pela ação AUTHORIZE_GUEST_ACCESS (especificação oficial). Fora
 * delas a controladora responde 400 e o guest não é liberado.
 */
const AUTHORIZE_RANGES = {
  timeLimitMinutes: [1, 1_000_000],
  dataUsageLimitMBytes: [1, 1_048_576],
  rxRateLimitKbps: [2, 100_000],
  txRateLimitKbps: [2, 100_000],
} as const;

function clientWaitMs(): number {
  const v = Number(process.env.UNIFI_CLIENT_WAIT_MS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_CLIENT_WAIT_MS;
}

type IntegrationState = {
  configVersion: string;
  prefix: string | null;
  sites: { value: IntegrationSite[]; expiresAt: number } | null;
  /** A controladora recusou `?filter=` (400): usa a varredura paginada direto. */
  noFilter: boolean;
};

type IntegrationSite = { id: string; internalReference?: string; name?: string };

type Page<T> = { offset?: number; limit?: number; count?: number; totalCount?: number; data?: T[] };

/** "Guest authorization usage details": contadores da autorização atual (zerados a cada AUTHORIZE). */
type IntegrationGuestUsage = { durationSec?: number; rxBytes?: number; txBytes?: number; bytes?: number };

/** "Guest authorization details" — só vem no detalhe do cliente, não na listagem. */
type IntegrationGuestAuthorization = {
  authorizedAt?: string;
  expiresAt?: string;
  authorizationMethod?: string;
  usage?: IntegrationGuestUsage;
};

type IntegrationClient = {
  id: string;
  name?: string;
  type?: string;
  macAddress?: string;
  ipAddress?: string;
  connectedAt?: string;
  uplinkDeviceId?: string;
  access?: { type?: string; authorized?: boolean; authorization?: IntegrationGuestAuthorization };
};

const g = globalThis as unknown as {
  __unifiIntegration?: IntegrationState;
  __unifiIntegrationDiag?: IntegrationState;
};

function state(cfg: UniFiConfig): IntegrationState {
  const slot = cfg.diagnostic ? "__unifiIntegrationDiag" : "__unifiIntegration";
  const cur = g[slot];
  if (!cur || cur.configVersion !== cfg.version) {
    g[slot] = { configVersion: cfg.version, prefix: null, sites: null, noFilter: false };
  }
  return g[slot]!;
}

export function clearIntegrationCache(): void {
  g.__unifiIntegration = undefined;
  g.__unifiIntegrationDiag = undefined;
}

async function call<T>(
  cfg: UniFiConfig,
  prefix: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<{ status: number; json: T | undefined; text: string }> {
  const res = await unifiHttp(`${cfg.url}${prefix}${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    insecureTls: cfg.insecureTls,
    noCircuit: cfg.diagnostic,
    headers: { "X-API-KEY": cfg.apiKey ?? "" },
  });
  return { status: res.status, json: res.json as T | undefined, text: res.text };
}

/**
 * Descobre o prefixo da API oficial. 404/HTML em todos os candidatos →
 * UniFiNotSupportedError (controladora sem a API, ex.: versão < 9 ou Classic).
 */
export async function integrationPrefix(cfg: UniFiConfig): Promise<string> {
  if (!cfg.apiKey) throw new UniFiAuthError("API Key não configurada");
  const st = state(cfg);
  if (st.prefix) return st.prefix;

  for (const prefix of PREFIX_CANDIDATES) {
    const res = await call<Page<IntegrationSite>>(cfg, prefix, "/v1/sites?limit=1");
    if (res.status === 401 || res.status === 403) {
      throw new UniFiAuthError(`API Key recusada pela API oficial (${res.status})`);
    }
    if (res.status < 300 && res.json && Array.isArray(res.json.data)) {
      st.prefix = prefix;
      logger.info({ prefix }, "UniFi Integration API detectada");
      return prefix;
    }
  }
  throw new UniFiNotSupportedError("API oficial (Integration API) não encontrada nesta controladora");
}

/** Erro no formato oficial ("Error Message": `code` + `message`), ou o corpo cru. */
function errorDetail(json: unknown, text: string): string {
  const e = json as { code?: unknown; message?: unknown } | undefined;
  const parts = [e?.code, e?.message].filter((v): v is string => typeof v === "string" && v.length > 0);
  return (parts.length > 0 ? parts.join(": ") : text).slice(0, 200);
}

async function request<T>(cfg: UniFiConfig, path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const prefix = await integrationPrefix(cfg);
  const res = await call<T>(cfg, prefix, path, init);
  if (res.status === 401 || res.status === 403) {
    throw new UniFiAuthError(`API Key sem permissão para ${path} (${res.status}): ${errorDetail(res.json, res.text)}`);
  }
  if (res.status === 404) throw new UniFiNotSupportedError(`Recurso inexistente na API oficial: ${path}`);
  if (res.status >= 300) {
    throw new UniFiClientError(res.status, `UniFi ${path} falhou (${res.status}): ${errorDetail(res.json, res.text)}`);
  }
  return res.json as T;
}

async function listAll<T>(cfg: UniFiConfig, path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await request<Page<T>>(cfg, `${path}${sep}offset=${page * PAGE_LIMIT}&limit=${PAGE_LIMIT}`);
    const data = res?.data ?? [];
    out.push(...data);
    if (data.length === 0) break;
    // Com totalCount, ele manda — a controladora pode limitar a página abaixo de
    // PAGE_LIMIT. Sem ele, página incompleta = última página.
    if (typeof res?.totalCount === "number" ? out.length >= res.totalCount : data.length < PAGE_LIMIT) break;
  }
  return out;
}

export async function integrationVersion(cfg: UniFiConfig): Promise<string | null> {
  try {
    const info = await request<{ applicationVersion?: string }>(cfg, "/v1/info");
    return info?.applicationVersion ?? null;
  } catch (err) {
    if (err instanceof UniFiNotSupportedError) return null;
    throw err;
  }
}

async function sitesCached(cfg: UniFiConfig): Promise<IntegrationSite[]> {
  const st = state(cfg);
  if (st.sites && st.sites.expiresAt > Date.now()) return st.sites.value;
  const value = await listAll<IntegrationSite>(cfg, "/v1/sites");
  st.sites = { value, expiresAt: Date.now() + SITE_CACHE_TTL_MS };
  return value;
}

export async function integrationListSites(cfg: UniFiConfig): Promise<UniFiSite[]> {
  const sites = await sitesCached(cfg);
  return sites.map((s) => ({
    name: s.internalReference ?? s.name ?? s.id,
    description: s.name ?? s.internalReference ?? s.id,
    id: s.id,
  }));
}

/**
 * Converte o nome curto do site (usado na URL do portal e na API legada) no
 * UUID da API oficial, via `internalReference`.
 */
export async function resolveSiteId(cfg: UniFiConfig, siteName: string): Promise<string> {
  const sites = await sitesCached(cfg);
  const lower = siteName.toLowerCase();
  const match =
    sites.find((s) => s.internalReference === siteName) ??
    sites.find((s) => s.id === siteName) ??
    sites.find((s) => (s.name ?? "").toLowerCase() === lower) ??
    (siteName === "default" && sites.length === 1 ? sites[0] : undefined);
  if (!match) throw new UniFiClientError(404, `Site "${siteName}" não encontrado na API oficial`);
  return match.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Listagem com `?filter=`; versões que recusam a sintaxe (400) caem na varredura
 * paginada — e a recusa fica memorizada para não repetir o request inútil.
 */
async function listClientsFiltered(cfg: UniFiConfig, siteId: string, filter: string): Promise<IntegrationClient[] | null> {
  const st = state(cfg);
  if (st.noFilter) return null;
  try {
    return await listAll<IntegrationClient>(cfg, `/v1/sites/${siteId}/clients?filter=${filter}`);
  } catch (err) {
    if (!(err instanceof UniFiClientError)) throw err;
    st.noFilter = true;
    logger.info({ err: err.message }, "UniFi Integration API sem suporte a filtro — usando varredura");
    return null;
  }
}

async function findClientByMac(cfg: UniFiConfig, siteId: string, mac: string): Promise<IntegrationClient | null> {
  const target = mac.toLowerCase();
  const matches = (c: IntegrationClient) => (c.macAddress ?? "").toLowerCase() === target;
  const filtered = await listClientsFiltered(cfg, siteId, encodeURIComponent(`macAddress.eq('${target}')`));
  const hit = filtered?.find(matches);
  if (hit) return hit;
  const all = await listAll<IntegrationClient>(cfg, `/v1/sites/${siteId}/clients`);
  return all.find(matches) ?? null;
}

async function requireClient(cfg: UniFiConfig, siteId: string, mac: string): Promise<IntegrationClient> {
  const started = Date.now();
  const deadline = started + clientWaitMs();
  let attempt = 0;
  for (;;) {
    const client = await findClientByMac(cfg, siteId, mac);
    if (client) {
      if (attempt > 0) logger.info({ mac, attempts: attempt + 1, waitedMs: Date.now() - started }, "UniFi client found after waiting");
      return client;
    }
    // Recém-associado: a controladora pode levar um tempo para listar o cliente.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const step = CLIENT_WAIT_STEPS_MS[Math.min(attempt, CLIENT_WAIT_STEPS_MS.length - 1)];
    await sleep(Math.min(step, remaining));
    attempt++;
  }
  throw new UniFiClientNotFoundError(
    `Cliente ${mac} não está conectado ao site (aguardado ${Math.round((Date.now() - started) / 1000)}s)`,
  );
}

/**
 * Encaixa o valor na faixa aceita pela API oficial. Ex.: limite de 200 Mbps vira
 * 100 Mbps (máximo da API) em vez de a controladora recusar a liberação inteira.
 */
function clampToSpec(field: keyof typeof AUTHORIZE_RANGES, value: number, mac: string): number {
  const [min, max] = AUTHORIZE_RANGES[field];
  const v = Math.round(value);
  if (v >= min && v <= max) return v;
  const applied = Math.min(max, Math.max(min, v));
  logger.warn({ mac, field, requested: value, applied }, "UniFi: valor fora da faixa da API oficial — ajustado");
  return applied;
}

export async function integrationAuthorizeGuest(cfg: UniFiConfig, siteName: string, p: AuthorizeParams): Promise<void> {
  const siteId = await resolveSiteId(cfg, siteName);
  const client = await requireClient(cfg, siteId, p.mac);
  const body: Record<string, unknown> = {
    action: "AUTHORIZE_GUEST_ACCESS",
    timeLimitMinutes: clampToSpec("timeLimitMinutes", p.minutes, p.mac),
  };
  // Mapeamento: rx = download do cliente, tx = upload (mesma convenção dos vouchers da API oficial).
  if (typeof p.downKbps === "number" && p.downKbps > 0) body.rxRateLimitKbps = clampToSpec("rxRateLimitKbps", p.downKbps, p.mac);
  if (typeof p.upKbps === "number" && p.upKbps > 0) body.txRateLimitKbps = clampToSpec("txRateLimitKbps", p.upKbps, p.mac);
  if (typeof p.bytesQuotaMB === "number" && p.bytesQuotaMB > 0) {
    body.dataUsageLimitMBytes = clampToSpec("dataUsageLimitMBytes", p.bytesQuotaMB, p.mac);
  }

  await request(cfg, `/v1/sites/${siteId}/clients/${client.id}/actions`, { method: "POST", body });
}

/**
 * Revoga o acesso e devolve os contadores finais da autorização revogada
 * (`revokedAuthorization.usage`, obrigatório na resposta desde a Network 9.1).
 * Depois disso o guest some da listagem — é a última chance de ler o tráfego.
 */
export async function integrationUnauthorizeGuest(
  cfg: UniFiConfig,
  siteName: string,
  mac: string,
): Promise<UniFiGuest | null> {
  const siteId = await resolveSiteId(cfg, siteName);
  const client = await findClientByMac(cfg, siteId, mac);
  if (!client || !client.macAddress) return null; // já desconectado — nada a revogar
  const res = await request<{ revokedAuthorization?: IntegrationGuestAuthorization } | undefined>(
    cfg,
    `/v1/sites/${siteId}/clients/${client.id}/actions`,
    { method: "POST", body: { action: "UNAUTHORIZE_GUEST_ACCESS" } },
  );
  const revoked = res?.revokedAuthorization;
  return revoked ? { ...toGuest(client, revoked), authorized: false } : null;
}

export type ListGuestsOptions = {
  /**
   * Busca os contadores de tráfego de cada guest autorizado. A listagem da API
   * oficial não traz bytes — eles ficam em `access.authorization.usage` no
   * detalhe do cliente (1 request por guest), então só quem exibe/grava tráfego pede.
   */
  withTraffic?: boolean;
};

function epochSec(iso?: string): number | undefined {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function toGuest(c: IntegrationClient, auth?: IntegrationGuestAuthorization): UniFiGuest {
  const a = auth ?? c.access?.authorization;
  return {
    mac: c.macAddress!.toLowerCase(),
    ip: c.ipAddress,
    hostname: c.name,
    start: epochSec(a?.authorizedAt) ?? epochSec(c.connectedAt),
    end: epochSec(a?.expiresAt),
    // rx = recebido pelo cliente (download), tx = enviado (upload) — mesma convenção dos limites.
    rx_bytes: count(a?.usage?.rxBytes),
    tx_bytes: count(a?.usage?.txBytes),
    authorized: c.access?.authorized,
  };
}

/** Executa `fn` com no máximo `limit` chamadas simultâneas, preservando a ordem. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Lista os guests conectados. Com `withTraffic`, completa cada guest autorizado
 * com os bytes da autorização atual. Falha no detalhe de um cliente (ex.: ele
 * desconectou entre a listagem e o detalhe) não derruba a listagem.
 */
export async function integrationListGuests(
  cfg: UniFiConfig,
  siteName: string,
  opts: ListGuestsOptions = {},
): Promise<UniFiGuest[]> {
  const siteId = await resolveSiteId(cfg, siteName);
  const listed =
    (await listClientsFiltered(cfg, siteId, GUEST_FILTER)) ??
    (await listAll<IntegrationClient>(cfg, `/v1/sites/${siteId}/clients`));
  const guests = listed.filter((c) => (c.access?.type ?? "").toUpperCase() === "GUEST" && c.macAddress);
  if (!opts.withTraffic) return guests.map((c) => toGuest(c));

  let failed = 0;
  let stop = false;
  const result = await mapLimit(guests, DETAIL_CONCURRENCY, async (c) => {
    if (stop || c.access?.authorized === false) return toGuest(c);
    try {
      const detail = await request<IntegrationClient>(cfg, `/v1/sites/${siteId}/clients/${encodeURIComponent(c.id)}`);
      return toGuest(c, detail?.access?.authorization);
    } catch (err) {
      failed++;
      // Controladora fora do ar ou chave recusada: não insiste nos demais guests.
      if (err instanceof UniFiUnavailableError || err instanceof UniFiAuthError) stop = true;
      logger.debug({ mac: c.macAddress, err: (err as Error).message }, "UniFi: detalhe do guest indisponível");
      return toGuest(c);
    }
  });
  if (failed > 0) logger.warn({ failed, guests: guests.length }, "UniFi: tráfego de alguns guests não pôde ser lido");
  return result;
}

export async function integrationFindMacByIp(cfg: UniFiConfig, siteName: string, ip: string): Promise<string | null> {
  const siteId = await resolveSiteId(cfg, siteName);
  const clients = await listAll<IntegrationClient>(cfg, `/v1/sites/${siteId}/clients`);
  return clients.find((c) => c.ipAddress === ip)?.macAddress?.toLowerCase() ?? null;
}

export async function integrationListDevices(cfg: UniFiConfig, siteName: string): Promise<UniFiDevice[]> {
  const siteId = await resolveSiteId(cfg, siteName);
  const devices = await listAll<{ macAddress?: string; name?: string; model?: string }>(
    cfg,
    `/v1/sites/${siteId}/devices`,
  );
  return devices
    .filter((d) => d.macAddress)
    .map((d) => ({ mac: d.macAddress!.toLowerCase(), name: d.name || d.macAddress!, model: d.model ?? null }));
}
