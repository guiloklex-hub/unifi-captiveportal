/**
 * Só aceita caminhos internos do painel como destino pós-login. Bloqueia
 * open redirect (`//evil.com`, `https://...`, `/\evil.com`) e `javascript:` (XSS).
 */
export function safeAdminNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/admin") || raw.startsWith("//") || raw.includes("\\")) {
    return "/admin";
  }
  return raw;
}

/**
 * Normaliza a URL de destino após autorizar o guest: apenas http(s) absoluta e
 * sem querystring (pode carregar tokens/códigos da URL original).
 */
export function sanitizeGuestRedirect(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}
