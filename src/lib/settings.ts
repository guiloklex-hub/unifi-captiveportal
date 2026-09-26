import { prisma } from "./prisma";
import { logger } from "./logger";
import { getTokenLocks } from "./tokenLocks";

export interface SystemSettings {
  brandName: string;
  logoUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string;
  termsOfUse: string;
  requireToken: boolean;
  singleDeviceByCpf: boolean;
}

const DEFAULT_SETTINGS: SystemSettings = {
  brandName: "UniFi Portal",
  logoUrl: null,
  backgroundUrl: null,
  primaryColor: "#171717",
  termsOfUse: "Ao conectar, você aceita os termos de uso e a política de privacidade.",
  requireToken: false,
  singleDeviceByCpf: false,
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// Why: layout + página + API chamavam `upsert` a cada request (uma escrita no
// SQLite por page view). Settings mudam raramente; cache curto em memória com
// invalidação explícita no save é suficiente para single-instance (PM2 fork).
// O cache vive em globalThis porque o Next empacota cada rota separadamente:
// uma variável de módulo seria uma cópia por rota e a invalidação feita na API
// de settings não chegaria às páginas.
const CACHE_TTL_MS = 30_000;
type SettingsCache = { value: SystemSettings; expiresAt: number } | null;
const store = globalThis as unknown as { __systemSettingsCache?: SettingsCache };

export function invalidateSystemSettingsCache(): void {
  store.__systemSettingsCache = null;
}

function toSettings(row: Partial<SystemSettings> | null): SystemSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(row ?? {}) } as SystemSettings;
  // Defesa em profundidade: a cor é interpolada num <style> no layout.
  if (!HEX_COLOR.test(merged.primaryColor)) merged.primaryColor = DEFAULT_SETTINGS.primaryColor;
  // Lock de `.env` tem precedência sobre o valor salvo no banco — sem isso o
  // portal ignorava TOKEN_LOCK_REQUIRE até o admin salvar a tela de settings.
  const locks = getTokenLocks();
  if (locks.requireToken !== undefined) merged.requireToken = locks.requireToken;
  return merged;
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const cache = store.__systemSettingsCache;
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  try {
    let row = await prisma.systemSettings.findUnique({ where: { id: "config" } });
    if (!row) {
      row = await prisma.systemSettings.upsert({
        where: { id: "config" },
        update: {},
        create: { id: "config", ...DEFAULT_SETTINGS },
      });
    }
    const value = toSettings(row);
    store.__systemSettingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Error fetching settings");
    return toSettings(null);
  }
}
