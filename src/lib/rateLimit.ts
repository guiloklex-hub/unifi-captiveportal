/**
 * Rate limit in-memory por chave (IP + rota). Janela deslizante simples.
 * Adequado para single-instance PM2. Para cluster/multi-node, trocar por Redis.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function cleanup(now: number): void {
  if (buckets.size < 1000) return;
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  cleanup(now);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    const next = { count: 1, resetAt: now + windowMs };
    buckets.set(key, next);
    return { allowed: true, remaining: max - 1, resetAt: next.resetAt };
  }

  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: max - bucket.count,
    resetAt: bucket.resetAt,
  };
}

/**
 * Extrai o IP do cliente em ordem de confiança decrescente.
 *
 * Why a ordem:
 *  1. `CF-Connecting-IP` — injetado pela Cloudflare, spoof exige comprometer a CF.
 *  2. `X-Real-IP` — geralmente injetado por proxy reverso (nginx) confiável.
 *  3. Último hop de `X-Forwarded-For` — mais resistente a spoof que o primeiro,
 *     porque o último elemento é adicionado pelo proxy reverso mais próximo do
 *     servidor; se o app está direto na internet, ainda é spoofável.
 *
 * O servidor PRECISA estar atrás de um proxy reverso confiável para que rate
 * limit e logs registrem o IP correto do cliente. Documentado no README.
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}
