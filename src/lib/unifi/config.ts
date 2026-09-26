import { prisma } from "../prisma";
import { logger } from "../logger";
import { decryptSecret } from "../crypto";

export type UniFiAuthMode = "auto" | "apikey" | "password";

export interface UniFiConfig {
  url: string;
  site: string;
  authMode: UniFiAuthMode;
  username?: string;
  password?: string;
  apiKey?: string;
  insecureTls: boolean;
  /** De onde veio a configuração efetiva. */
  source: "env" | "db";
  /** Muda sempre que a configuração muda — invalida sessões/caches dependentes. */
  version: string;
  /**
   * Rascunho sendo testado pelo painel: usa estado isolado (sessão/caches) e não
   * alimenta o circuit breaker — um teste com URL errada não afeta os guests.
   */
  diagnostic?: boolean;
}

const AUTH_MODES: UniFiAuthMode[] = ["auto", "apikey", "password"];

export function parseAuthMode(raw: string | undefined | null): UniFiAuthMode {
  const v = (raw ?? "").trim().toLowerCase();
  return (AUTH_MODES as string[]).includes(v) ? (v as UniFiAuthMode) : "auto";
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function envConfig(): UniFiConfig {
  const url = normalizeUrl(process.env.UNIFI_URL ?? "");
  const cfg: UniFiConfig = {
    url,
    site: process.env.UNIFI_SITE?.trim() || "default",
    authMode: parseAuthMode(process.env.UNIFI_AUTH_MODE),
    username: process.env.UNIFI_USERNAME || undefined,
    password: process.env.UNIFI_PASSWORD || undefined,
    apiKey: process.env.UNIFI_API_KEY?.trim() || undefined,
    insecureTls: process.env.UNIFI_INSECURE_TLS === "true",
    source: "env",
    version: "",
  };
  cfg.version = fingerprintConfig(cfg);
  return cfg;
}

function fingerprintConfig(cfg: Omit<UniFiConfig, "version">): string {
  return [
    cfg.source,
    cfg.url,
    cfg.site,
    cfg.authMode,
    cfg.username ?? "",
    cfg.password ? `p${cfg.password.length}:${cfg.password.slice(-2)}` : "",
    cfg.apiKey ? `k${cfg.apiKey.length}:${cfg.apiKey.slice(-4)}` : "",
    cfg.insecureTls ? "1" : "0",
  ].join("|");
}

// Cache em globalThis: o Next empacota cada rota separadamente, e sem isso cada
// bundle teria sua própria cópia (e sua própria sessão com a controladora).
const CACHE_TTL_MS = 30_000;
type ConfigCache = { value: UniFiConfig; expiresAt: number } | null;
const store = globalThis as unknown as { __unifiConfigCache?: ConfigCache };

export function invalidateUniFiConfigCache(): void {
  store.__unifiConfigCache = null;
}

/**
 * Configuração efetiva: registro `UniFiConnection` do banco (salvo pelo painel)
 * quando existir; senão, variáveis `UNIFI_*` do `.env`.
 */
export async function getUniFiConfig(): Promise<UniFiConfig> {
  const cached = store.__unifiConfigCache;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value = envConfig();
  try {
    const row = await prisma.uniFiConnection.findUnique({ where: { id: "default" } });
    if (row && row.url) {
      const cfg: Omit<UniFiConfig, "version"> = {
        url: normalizeUrl(row.url),
        site: row.site || "default",
        authMode: parseAuthMode(row.authMode),
        username: row.username || undefined,
        password: row.passwordEnc ? safeDecrypt(row.passwordEnc, "password") : undefined,
        apiKey: row.apiKeyEnc ? safeDecrypt(row.apiKeyEnc, "apiKey") : undefined,
        insecureTls: row.insecureTls,
        source: "db",
      };
      value = { ...cfg, version: `${fingerprintConfig(cfg)}|${row.updatedAt.getTime()}` };
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "UniFi config: falha ao ler do banco, usando .env");
  }

  store.__unifiConfigCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

function safeDecrypt(value: string, field: string): string | undefined {
  try {
    return decryptSecret(value);
  } catch (err) {
    logger.error(
      { field, err: (err as Error).message },
      "UniFi config: não foi possível decifrar segredo salvo (ADMIN_SECRET/DATA_ENCRYPTION_KEY mudou?)",
    );
    return undefined;
  }
}

export function hasApiKey(cfg: UniFiConfig): boolean {
  return Boolean(cfg.apiKey);
}

export function hasPassword(cfg: UniFiConfig): boolean {
  return Boolean(cfg.username && cfg.password);
}
