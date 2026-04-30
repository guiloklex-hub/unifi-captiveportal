/**
 * Fingerprint leve do navegador. NÃO substitui MAC: serve como sinal
 * complementar para detectar reuso fraudulento (MAC spoofing).
 *
 * Concatena sinais estáveis (UA, idioma, timezone, plataforma, viewport,
 * deviceMemory) e gera SHA-256 hex. O cliente envia; o servidor armazena
 * e correlaciona — não é "anti-spoof" perfeito, é defesa em profundidade.
 */
export async function computeFingerprint(): Promise<string | null> {
  if (typeof window === "undefined" || typeof crypto?.subtle === "undefined") {
    return null;
  }
  try {
    const parts = [
      navigator.userAgent || "",
      navigator.language || "",
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      // @ts-expect-error - userAgentData não está no DOM lib estável
      navigator.userAgentData?.platform ?? navigator.platform ?? "",
      `${screen.width}x${screen.height}`,
      String(screen.colorDepth || ""),
      // @ts-expect-error - deviceMemory existe em alguns navegadores
      String(navigator.deviceMemory ?? ""),
      String(navigator.hardwareConcurrency ?? ""),
    ].join("||");

    const buf = new TextEncoder().encode(parts);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}
