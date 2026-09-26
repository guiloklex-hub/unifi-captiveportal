/**
 * URL pública do portal usada em deep-links (QR de tokens, vouchers impressos).
 * `PUBLIC_PORTAL_URL` tem precedência; sem ela, usa o Host da requisição —
 * que pode ser interno (127.0.0.1) quando o painel é acessado localmente.
 */
export function portalBaseUrl(headers: Pick<Headers, "get">): string {
  const envBase = process.env.PUBLIC_PORTAL_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const host = headers.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

export function tokenDeepLink(base: string, token: { code: string; site?: string | null }): string {
  const site = encodeURIComponent(token.site || "default");
  return `${base}/guest/s/${site}?token=${encodeURIComponent(token.code)}`;
}
