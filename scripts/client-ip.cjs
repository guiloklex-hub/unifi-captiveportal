/**
 * IP real do cliente, carregado antes do servidor:
 *
 *   node --require ./scripts/client-ip.cjs server.js     (Docker)
 *   NODE_OPTIONS="--require ./scripts/client-ip.cjs"     (PM2 / next start)
 *
 * Why: o Next só preenche `X-Forwarded-For` com o IP da conexão quando o
 * cliente NÃO manda o cabeçalho — e `clientIp()` também lê `X-Real-IP` e
 * `CF-Connecting-IP`. Sem proxy reverso (Docker exposto na porta 80), qualquer
 * um forjava o IP: burlava o rate limit do login, a allowlist do painel e
 * gravava o IP que quisesse nos logs de conexão (Marco Civil).
 *
 * Aqui, quando a conexão NÃO vem de um proxy confiável, os cabeçalhos de IP
 * são descartados e `X-Forwarded-For` passa a ser o endereço do socket.
 *
 * TRUST_PROXY:
 *   (vazio)            confia só em loopback — nginx no mesmo host continua funcionando
 *   "true"             confia em qualquer origem (só atrás de um proxy que sobrescreve os cabeçalhos)
 *   "false"            nunca confia; sempre o IP do socket
 *   "172.17.0.1,10.0.0.0/8"  IPs/CIDRs dos proxies confiáveis (loopback incluído)
 */
"use strict";

const http = require("node:http");
const net = require("node:net");

const IP_HEADERS = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"];

/** `::ffff:10.0.0.1` → `10.0.0.1` */
function normalizeIp(ip) {
  if (!ip) return "";
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : ip;
}

function addEntry(list, entry) {
  const [addr, bits] = entry.split("/");
  const family = net.isIPv4(addr) ? "ipv4" : net.isIPv6(addr) ? "ipv6" : null;
  if (!family) throw new Error(`TRUST_PROXY: endereço inválido "${entry}"`);
  if (bits === undefined) list.addAddress(addr, family);
  else list.addSubnet(addr, Number(bits), family);
}

/** Devolve `(ip) => boolean` dizendo se a conexão vem de um proxy confiável. */
function parseTrustProxy(value) {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "true" || v === "all") return () => true;
  if (v === "false" || v === "none") return () => false;

  const list = new net.BlockList();
  list.addSubnet("127.0.0.0", 8, "ipv4");
  list.addAddress("::1", "ipv6");
  for (const entry of v.split(",").map((s) => s.trim()).filter(Boolean)) addEntry(list, entry);
  return (ip) => {
    const addr = normalizeIp(ip);
    if (net.isIPv4(addr)) return list.check(addr, "ipv4");
    if (net.isIPv6(addr)) return list.check(addr, "ipv6");
    return false;
  };
}

/** Ajusta os cabeçalhos de IP de uma requisição (exportado para os testes). */
function sanitizeClientIpHeaders(headers, remoteAddress, isTrusted) {
  if (isTrusted(remoteAddress)) return;
  for (const h of IP_HEADERS) delete headers[h];
  const ip = normalizeIp(remoteAddress);
  if (ip) headers["x-forwarded-for"] = ip;
}

function install(trustProxy = process.env.TRUST_PROXY) {
  const isTrusted = parseTrustProxy(trustProxy);
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, req, ...rest) {
    if (event === "request" && req && req.socket) {
      sanitizeClientIpHeaders(req.headers, req.socket.remoteAddress, isTrusted);
    }
    return emit.call(this, event, req, ...rest);
  };
}

module.exports = { normalizeIp, parseTrustProxy, sanitizeClientIpHeaders, install };

// Carregado via --require: instala o hook. Importado pelos testes: não instala.
if (require.main !== module && !process.env.VITEST) install();
