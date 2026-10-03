import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Redes de onde o painel admin pode ser acessado (ADMIN_ALLOWED_NETWORKS).
 *
 * Why: com portal externo, a UniFi libera o IP do portal para guests ainda não
 * autenticados — e o painel está no mesmo IP e porta. Sem esta allowlist,
 * qualquer visitante da rede guest abre /admin/login. Loopback é sempre
 * permitido (cron local, túnel SSH). Vazio = sem restrição.
 *
 * Depende do IP real do cliente (scripts/client-ip.cjs); sem ele, bastaria
 * forjar X-Real-IP.
 */

export function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : ip;
}

function family(ip: string): "ipv4" | "ipv6" | null {
  return isIPv4(ip) ? "ipv4" : isIPv6(ip) ? "ipv6" : null;
}

/** Lança com mensagem clara se alguma entrada for inválida. */
export function parseNetworks(value: string): BlockList | null {
  const entries = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return null;
  const list = new BlockList();
  list.addSubnet("127.0.0.0", 8, "ipv4");
  list.addAddress("::1", "ipv6");
  for (const entry of entries) {
    const [addr, bits] = entry.split("/");
    const fam = family(addr);
    const prefix = Number(bits);
    if (!fam || (bits !== undefined && !(Number.isInteger(prefix) && prefix >= 0 && prefix <= (fam === "ipv4" ? 32 : 128)))) {
      throw new Error(`ADMIN_ALLOWED_NETWORKS: entrada inválida "${entry}"`);
    }
    if (bits === undefined) list.addAddress(addr, fam);
    else list.addSubnet(addr, prefix, fam);
  }
  return list;
}

export function ipInList(list: BlockList, ip: string): boolean {
  const addr = normalizeIp(ip);
  const fam = family(addr);
  return fam ? list.check(addr, fam) : false;
}

let cached: { raw: string; list: BlockList | null } | null = null;

function allowedList(): BlockList | null {
  const raw = process.env.ADMIN_ALLOWED_NETWORKS ?? "";
  if (cached?.raw !== raw) cached = { raw, list: parseNetworks(raw) };
  return cached.list;
}

/** Sem ADMIN_ALLOWED_NETWORKS, tudo é permitido. IP desconhecido nunca passa. */
export function adminNetworkAllowed(ip: string): boolean {
  const list = allowedList();
  return list === null || ipInList(list, ip);
}

export function isLoopback(ip: string): boolean {
  const addr = normalizeIp(ip);
  return addr === "::1" || /^127\./.test(addr);
}

/** Pode ver detalhes internos (healthz): loopback ou rede admin configurada. */
export function isInternalRequest(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const list = allowedList();
  return list !== null && ipInList(list, ip);
}
