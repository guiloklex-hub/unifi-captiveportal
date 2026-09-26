import { z } from "zod";
import { prisma } from "../prisma";
import { encryptSecret } from "../crypto";
import { getUniFiConfig, invalidateUniFiConfigCache, normalizeUrl, parseAuthMode, type UniFiConfig } from "./config";
import { clearUniFiSession } from "./index";

/**
 * Persistência da conexão UniFi editada pelo painel. Segredos nunca voltam ao
 * navegador: a API devolve apenas `hasPassword` / `hasApiKey`.
 */

export const connectionInputSchema = z.object({
  url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" || u.protocol === "http:";
      } catch {
        return false;
      }
    }, "URL deve ser http(s)://host[:porta]"),
  site: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "Site inválido").default("default"),
  authMode: z.enum(["auto", "apikey", "password"]).default("auto"),
  username: z.string().trim().max(120).optional().nullable(),
  /** Vazio/ausente = mantém a senha salva. */
  password: z.string().max(256).optional().nullable(),
  /** Vazio/ausente = mantém a chave salva. */
  apiKey: z.string().trim().max(512).optional().nullable(),
  clearPassword: z.boolean().optional(),
  clearApiKey: z.boolean().optional(),
  insecureTls: z.boolean().default(false),
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export type ConnectionView = {
  source: "env" | "db";
  url: string;
  site: string;
  authMode: UniFiConfig["authMode"];
  username: string | null;
  hasPassword: boolean;
  hasApiKey: boolean;
  insecureTls: boolean;
};

export async function getConnectionView(): Promise<ConnectionView> {
  const cfg = await getUniFiConfig();
  return {
    source: cfg.source,
    url: cfg.url,
    site: cfg.site,
    authMode: cfg.authMode,
    username: cfg.username ?? null,
    hasPassword: Boolean(cfg.password),
    hasApiKey: Boolean(cfg.apiKey),
    insecureTls: cfg.insecureTls,
  };
}

/**
 * Monta a configuração resultante de um formulário sem gravá-la — campos de
 * segredo em branco herdam o valor atual. Usado pelo "Testar conexão".
 */
export async function draftConfig(input: ConnectionInput): Promise<UniFiConfig> {
  const current = await getUniFiConfig();
  const password = input.clearPassword ? undefined : input.password || current.password;
  const apiKey = input.clearApiKey ? undefined : input.apiKey || current.apiKey;
  return {
    url: normalizeUrl(input.url),
    site: input.site,
    authMode: parseAuthMode(input.authMode),
    username: input.username || undefined,
    password,
    apiKey,
    insecureTls: input.insecureTls,
    source: "db",
    version: `draft:${Date.now()}:${Math.random()}`,
    diagnostic: true,
  };
}

export async function saveConnection(input: ConnectionInput): Promise<void> {
  const cfg = await draftConfig(input); // só para herdar segredos em branco
  // Só persiste o que o modo escolhido usa: "Somente API Key" não guarda senha
  // (nem herdada do .env) e "Somente usuário e senha" não guarda a chave.
  const keepPassword = cfg.authMode !== "apikey";
  const keepApiKey = cfg.authMode !== "password";
  const data = {
    url: cfg.url,
    site: cfg.site,
    authMode: cfg.authMode,
    username: keepPassword ? (cfg.username ?? null) : null,
    passwordEnc: keepPassword && cfg.password ? encryptSecret(cfg.password) : null,
    apiKeyEnc: keepApiKey && cfg.apiKey ? encryptSecret(cfg.apiKey) : null,
    insecureTls: cfg.insecureTls,
  };
  await prisma.uniFiConnection.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
  invalidateUniFiConfigCache();
  clearUniFiSession();
}

/** Remove a configuração do banco — volta a valer o `.env`. */
export async function resetConnection(): Promise<void> {
  await prisma.uniFiConnection.deleteMany({ where: { id: "default" } });
  invalidateUniFiConfigCache();
  clearUniFiSession();
}
