import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";

/**
 * Diagnóstico de falhas de rede ao falar com a controladora. O undici reporta
 * tudo como "fetch failed" e esconde o motivo real em `err.cause` — sem ele o
 * admin não distingue porta fechada, rota inexistente, firewall ou certificado.
 */

const CODE_HINTS: Record<string, string> = {
  ECONNREFUSED: "conexão recusada: porta fechada ou serviço parado (confira a porta, ex.: 8443 ou 443)",
  EHOSTUNREACH: "host inalcançável: não há rota até a controladora a partir deste servidor",
  ENETUNREACH: "rede inalcançável: não há rota até a controladora a partir deste servidor",
  ETIMEDOUT: "tempo esgotado: firewall bloqueando ou IP incorreto",
  UND_ERR_CONNECT_TIMEOUT: "tempo de conexão esgotado: firewall bloqueando, IP incorreto ou sem rota",
  UND_ERR_HEADERS_TIMEOUT: "a controladora aceitou a conexão mas não respondeu a tempo",
  ENOTFOUND: "nome não encontrado no DNS",
  EAI_AGAIN: "falha temporária de DNS",
  ECONNRESET: "conexão encerrada pela controladora",
  EPROTO: "falha no TLS: a porta pode ser HTTP, não HTTPS",
  DEPTH_ZERO_SELF_SIGNED_CERT: "certificado autoassinado: marque “Aceitar certificado autoassinado”",
  SELF_SIGNED_CERT_IN_CHAIN: "certificado autoassinado: marque “Aceitar certificado autoassinado”",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificado não confiável: marque “Aceitar certificado autoassinado”",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "certificado não confiável: marque “Aceitar certificado autoassinado”",
  CERT_HAS_EXPIRED: "certificado expirado",
  ERR_TLS_CERT_ALTNAME_INVALID: "o certificado não corresponde ao endereço da URL",
};

/** Mensagem do erro com o código da causa raiz (ex.: "fetch failed — EHOSTUNREACH: host inalcançável…"). */
export function networkErrorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") {
      const hint = CODE_HINTS[code] ?? (code.startsWith("ERR_SSL") ? "falha no TLS" : null);
      return hint ? `${message} — ${code}: ${hint}` : `${message} — ${code}`;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return message;
}

type Iface = { address: string; netmask: string; family: string | number; internal: boolean };

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function prefixLength(netmask: string): number {
  return ipv4ToInt(netmask).toString(2).replace(/0/g, "").length;
}

/**
 * Sub-rede de uma interface local que contém `host` (sem ser o próprio IP).
 * Dentro de um container, isso indica que o IP da controladora colide com a rede
 * interna do Docker — os pacotes ficam na bridge e nunca chegam à LAN.
 */
export function findSubnetConflict(host: string, ifaces: Iface[]): string | null {
  if (isIP(host) !== 4) return null;
  const target = ipv4ToInt(host);
  for (const i of ifaces) {
    if (i.internal || (i.family !== "IPv4" && i.family !== 4) || i.address === host) continue;
    const mask = ipv4ToInt(i.netmask);
    if ((ipv4ToInt(i.address) & mask) >>> 0 === (target & mask) >>> 0) {
      const network = (ipv4ToInt(i.address) & mask) >>> 0;
      const net = [24, 16, 8, 0].map((s) => (network >>> s) & 255).join(".");
      return `${net}/${prefixLength(i.netmask)}`;
    }
  }
  return null;
}

function inContainer(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

/** Dica exibida quando a controladora está inalcançável a partir de um container. */
export function containerNetworkHint(url: string): string | null {
  if (!inContainer()) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const ifaces = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
  const subnet = findSubnetConflict(host, ifaces);
  if (subnet) {
    return (
      `O IP da controladora (${host}) está dentro da rede interna do Docker (${subnet}). ` +
      `O container entrega esses pacotes à própria bridge e eles nunca chegam à controladora. ` +
      `Mude a sub-rede do Docker (docker-compose.yml → networks) — ver README, seção 0.`
    );
  }
  return (
    `O portal roda em container: o teste parte do servidor, não do seu computador. ` +
    `No servidor, rode "ip route get ${host}" — se a saída citar docker0 ou br-…, ` +
    `o IP colide com uma rede do Docker (README, seção 0).`
  );
}
