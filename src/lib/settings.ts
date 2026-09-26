import { prisma } from "./prisma";
import { logger } from "./logger";
import { getTokenLocks } from "./tokenLocks";

export type FieldMode = "required" | "optional" | "hidden";
export const FIELD_MODES: readonly FieldMode[] = ["required", "optional", "hidden"];

export interface SystemSettings {
  brandName: string;
  logoUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string;
  termsOfUse: string;
  requireToken: boolean;
  singleDeviceByCpf: boolean;
  defaultDurationMin: number | null;
  defaultDownKbps: number | null;
  defaultUpKbps: number | null;
  defaultQuotaMB: number | null;
  fieldName: FieldMode;
  fieldEmail: FieldMode;
  fieldPhone: FieldMode;
  fieldDocument: FieldMode;
  allowForeignDocument: boolean;
  rememberDeviceDays: number;
}

const DEFAULT_SETTINGS: SystemSettings = {
  brandName: "UniFi Portal",
  logoUrl: null,
  backgroundUrl: null,
  primaryColor: "#171717",
  termsOfUse: "Ao conectar, você aceita os termos de uso e a política de privacidade.",
  requireToken: false,
  singleDeviceByCpf: false,
  defaultDurationMin: null,
  defaultDownKbps: null,
  defaultUpKbps: null,
  defaultQuotaMB: null,
  fieldName: "required",
  fieldEmail: "required",
  fieldPhone: "required",
  fieldDocument: "required",
  allowForeignDocument: false,
  rememberDeviceDays: 0,
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
type BrandingCache = Map<string, { value: SiteBranding | null; expiresAt: number }>;
const store = globalThis as unknown as {
  __systemSettingsCache?: SettingsCache;
  __siteBrandingCache?: BrandingCache;
};

export function invalidateSystemSettingsCache(): void {
  store.__systemSettingsCache = null;
  store.__siteBrandingCache = new Map();
}

function fieldMode(v: unknown): FieldMode {
  return (FIELD_MODES as readonly unknown[]).includes(v) ? (v as FieldMode) : "required";
}

function toSettings(row: Partial<SystemSettings> | null): SystemSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(row ?? {}) } as SystemSettings;
  // Defesa em profundidade: a cor é interpolada num <style> no layout.
  if (!HEX_COLOR.test(merged.primaryColor)) merged.primaryColor = DEFAULT_SETTINGS.primaryColor;
  merged.fieldName = fieldMode(merged.fieldName);
  merged.fieldEmail = fieldMode(merged.fieldEmail);
  merged.fieldPhone = fieldMode(merged.fieldPhone);
  merged.fieldDocument = fieldMode(merged.fieldDocument);
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
    const value = toSettings(row as Partial<SystemSettings>);
    store.__systemSettingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Error fetching settings");
    return toSettings(null);
  }
}

// ─── Marca por site ─────────────────────────────────────────────────────────

export type SiteBranding = {
  site: string;
  brandName: string | null;
  logoUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string | null;
  termsOfUse: string | null;
};

export type Branding = Pick<SystemSettings, "brandName" | "logoUrl" | "backgroundUrl" | "primaryColor" | "termsOfUse">;

async function getSiteBranding(site: string): Promise<SiteBranding | null> {
  const cache = (store.__siteBrandingCache ??= new Map());
  const hit = cache.get(site);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value: SiteBranding | null = null;
  try {
    value = await prisma.siteBranding.findUnique({ where: { site } });
  } catch (err) {
    logger.warn({ site, err: (err as Error).message }, "site branding lookup failed");
  }
  cache.set(site, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Marca efetiva de um site: sobrescritas do site sobre a marca global. */
export async function resolveBranding(settings: SystemSettings, site?: string | null): Promise<Branding> {
  const base: Branding = {
    brandName: settings.brandName,
    logoUrl: settings.logoUrl,
    backgroundUrl: settings.backgroundUrl,
    primaryColor: settings.primaryColor,
    termsOfUse: settings.termsOfUse,
  };
  if (!site) return base;
  const o = await getSiteBranding(site);
  if (!o) return base;
  return {
    brandName: o.brandName || base.brandName,
    logoUrl: o.logoUrl || base.logoUrl,
    backgroundUrl: o.backgroundUrl || base.backgroundUrl,
    primaryColor: o.primaryColor && HEX_COLOR.test(o.primaryColor) ? o.primaryColor : base.primaryColor,
    termsOfUse: o.termsOfUse || base.termsOfUse,
  };
}

// ─── Política de acesso padrão ──────────────────────────────────────────────

export type GuestPolicy = {
  minutes: number;
  downKbps?: number;
  upKbps?: number;
  bytesQuotaMB?: number;
};

function positiveOrUndefined(n: number | null | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function envInt(name: string): number | undefined {
  return positiveOrUndefined(parseInt(process.env[name] ?? "", 10));
}

/**
 * Duração e limites aplicados a quem entra sem token: valores do painel
 * (Customização → Perfil padrão) ou, na ausência deles, `GUEST_*` do `.env`.
 */
export function defaultGuestPolicy(settings: SystemSettings): GuestPolicy {
  return {
    minutes: positiveOrUndefined(settings.defaultDurationMin) ?? envInt("GUEST_DURATION_MIN") ?? 480,
    downKbps: settings.defaultDownKbps != null ? positiveOrUndefined(settings.defaultDownKbps) : envInt("GUEST_DOWN_KBPS"),
    upKbps: settings.defaultUpKbps != null ? positiveOrUndefined(settings.defaultUpKbps) : envInt("GUEST_UP_KBPS"),
    bytesQuotaMB: settings.defaultQuotaMB != null ? positiveOrUndefined(settings.defaultQuotaMB) : envInt("GUEST_QUOTA_MB"),
  };
}
