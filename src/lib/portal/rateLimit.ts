import { NextResponse } from "next/server";
import { logger } from "../logger";
import { rateLimit } from "../rateLimit";
import type { Dictionary } from "../i18n/dictionaries";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
// Teto global de segurança (todas as origens somadas) — protege a controladora
// de rajadas sem penalizar eventos com muitos guests simultâneos.
const RATE_LIMIT_GLOBAL_MAX = 600;

/**
 * Rate limit das rotas públicas do portal. Devolve a resposta 429 pronta ou
 * `null` quando liberado.
 *
 * Why: sem proxy reverso (Node direto na porta 80, como no guia de instalação)
 * não há cabeçalho com o IP do cliente e `clientIp` devolve "unknown" — todos
 * os guests cairiam no MESMO bucket. Nesse caso a chave passa a ser o MAC
 * informado pela controladora.
 */
export function portalRateLimit(
  scope: string,
  ip: string,
  body: unknown,
  dict: Dictionary,
  max = RATE_LIMIT_MAX,
): NextResponse | null {
  const rawMac =
    typeof (body as { mac?: unknown })?.mac === "string" ? (body as { mac: string }).mac.trim().toLowerCase() : "";
  const key = ip !== "unknown" ? `ip:${ip}` : `mac:${rawMac || "none"}`;
  const rl = rateLimit(`${scope}:${key}`, max, RATE_LIMIT_WINDOW_MS);
  const rlGlobal = rateLimit(`${scope}:global`, RATE_LIMIT_GLOBAL_MAX, RATE_LIMIT_WINDOW_MS);
  if (rl.allowed && rlGlobal.allowed) return null;

  const resetAt = !rl.allowed ? rl.resetAt : rlGlobal.resetAt;
  logger.warn({ scope, key, global: !rlGlobal.allowed, resetAt }, "portal rate-limited");
  return NextResponse.json(
    { error: dict.portal.errRateLimited },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) } },
  );
}
