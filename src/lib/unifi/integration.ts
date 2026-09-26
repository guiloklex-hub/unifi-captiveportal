import { logger } from "../logger";
import type { UniFiConfig } from "./config";
import { UniFiAuthError, UniFiClientError, UniFiNotSupportedError } from "./errors";
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
 * Operações usadas:
 *   GET  /v1/info
 *   GET  /v1/sites                                      (id ↔ internalReference = nome curto legado)
 *   GET  /v1/sites/{siteId}/clients?filter=macAddress.eq('..')
 *   POST /v1/sites/{siteId}/clients/{clientId}/actions  { action: AUTHORIZE_GUEST_ACCESS | UNAUTHORIZE_GUEST_ACCESS }
 *   GET  /v1/sites/{siteId}/devices
 */

const PREFIX_CANDIDATES = ["/proxy/network/integration", "/integration"];
const SITE_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;

type IntegrationState = {
  configVersion: string;
  prefix: string | null;
  sites: { value: IntegrationSite[]; expiresAt: number } | null;
};

type IntegrationSite = { id: string; internalReference?: string; name?: string };

type Page<T> = { offset?: number; limit?: number; count?: number; totalCount?: number; data?: T[] };

type IntegrationClient = {
  id: string;
  name?: string;
  type?: string;
  macAddress?: string;
  ipAddress?: string;
  connectedAt?: string;
  uplinkDeviceId?: string;
  access?: { type?: string; authorized?: boolean };
};

const g = globalThis as unknown as {
  __unifiIntegration?: IntegrationState;
  __unifiIntegrationDiag?: IntegrationState;
};

function state(cfg: UniFiConfig): IntegrationState {
  const slot = cfg.diagnostic ? "__unifiIntegrationDiag" : "__unifiIntegration";
  const cur = g[slot];
  if (!cur || cur.configVersion !== cfg.version) {
    g[slot] = { configVersion: cfg.version, prefix: null, sites: null };
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

async function request<T>(cfg: UniFiConfig, path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const prefix = await integrationPrefix(cfg);
  const res = await call<T>(cfg, prefix, path, init);
  if (res.status === 401 || res.status === 403) {
    throw new UniFiAuthError(`API Key sem permissão para ${path} (${res.status})`);
  }
  if (res.status === 404) throw new UniFiNotSupportedError(`Recurso inexistente na API oficial: ${path}`);
  if (res.status >= 300) {
    throw new UniFiClientError(res.status, `UniFi ${path} falhou (${res.status}): ${res.text.slice(0, 200)}`);
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
    const total = res?.totalCount ?? out.length;
    if (data.length < PAGE_LIMIT || out.length >= total) break;
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

async function findClientByMac(cfg: UniFiConfig, siteId: string, mac: string): Promise<IntegrationClient | null> {
  const target = mac.toLowerCase();
  const matches = (c: IntegrationClient) => (c.macAddress ?? "").toLowerCase() === target;
  try {
    const filter = encodeURIComponent(`macAddress.eq('${target}')`);
    const res = await request<Page<IntegrationClient>>(cfg, `/v1/sites/${siteId}/clients?filter=${filter}&limit=5`);
    const hit = (res?.data ?? []).find(matches);
    if (hit) return hit;
  } catch (err) {
    // Versões sem suporte à sintaxe de filtro respondem 400: cai na varredura paginada.
    if (!(err instanceof UniFiClientError)) throw err;
  }
  const all = await listAll<IntegrationClient>(cfg, `/v1/sites/${siteId}/clients`);
  return all.find(matches) ?? null;
}

async function requireClient(cfg: UniFiConfig, siteId: string, mac: string): Promise<IntegrationClient> {
  let client = await findClientByMac(cfg, siteId, mac);
  if (!client) {
    // Recém-associado: a controladora pode levar um instante para listar o cliente.
    await sleep(1_500);
    client = await findClientByMac(cfg, siteId, mac);
  }
  if (!client) throw new UniFiClientError(404, `Cliente ${mac} não está conectado ao site`);
  return client;
}

export async function integrationAuthorizeGuest(cfg: UniFiConfig, siteName: string, p: AuthorizeParams): Promise<void> {
  const siteId = await resolveSiteId(cfg, siteName);
  const client = await requireClient(cfg, siteId, p.mac);
  const body: Record<string, unknown> = {
    action: "AUTHORIZE_GUEST_ACCESS",
    timeLimitMinutes: p.minutes,
  };
  // Mapeamento: rx = download do cliente, tx = upload (mesma convenção dos vouchers da API oficial).
  if (typeof p.downKbps === "number" && p.downKbps > 0) body.rxRateLimitKbps = p.downKbps;
  if (typeof p.upKbps === "number" && p.upKbps > 0) body.txRateLimitKbps = p.upKbps;
  if (typeof p.bytesQuotaMB === "number" && p.bytesQuotaMB > 0) body.dataUsageLimitMBytes = p.bytesQuotaMB;

  await request(cfg, `/v1/sites/${siteId}/clients/${client.id}/actions`, { method: "POST", body });
}

export async function integrationUnauthorizeGuest(cfg: UniFiConfig, siteName: string, mac: string): Promise<void> {
  const siteId = await resolveSiteId(cfg, siteName);
  const client = await findClientByMac(cfg, siteId, mac);
  if (!client) return; // já desconectado — nada a revogar
  await request(cfg, `/v1/sites/${siteId}/clients/${client.id}/actions`, {
    method: "POST",
    body: { action: "UNAUTHORIZE_GUEST_ACCESS" },
  });
}

/**
 * Lista clientes guest. A API oficial não expõe contadores de tráfego por
 * cliente — tx/rx ficam ausentes (a API legada é preferida para estatísticas).
 */
export async function integrationListGuests(cfg: UniFiConfig, siteName: string): Promise<UniFiGuest[]> {
  const siteId = await resolveSiteId(cfg, siteName);
  const clients = await listAll<IntegrationClient>(cfg, `/v1/sites/${siteId}/clients`);
  return clients
    .filter((c) => (c.access?.type ?? "").toUpperCase() === "GUEST" && c.macAddress)
    .map((c) => ({
      mac: c.macAddress!.toLowerCase(),
      ip: c.ipAddress,
      hostname: c.name,
      start: c.connectedAt ? Math.floor(new Date(c.connectedAt).getTime() / 1000) : undefined,
      authorized: c.access?.authorized,
    }));
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
