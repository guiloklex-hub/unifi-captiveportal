import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

type Trust = (ip: string) => boolean;
const { parseTrustProxy, sanitizeClientIpHeaders } = createRequire(import.meta.url)("../../scripts/client-ip.cjs") as {
  parseTrustProxy: (v?: string) => Trust;
  sanitizeClientIpHeaders: (h: Record<string, string>, remote: string, trusted: Trust) => void;
};

const forged = () => ({ "x-real-ip": "6.6.6.6", "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6", host: "p" });

describe("IP real do cliente (scripts/client-ip.cjs)", () => {
  it("conexão direta: cabeçalhos forjados são trocados pelo IP do socket", () => {
    const h = forged();
    sanitizeClientIpHeaders(h, "::ffff:192.168.0.39", parseTrustProxy(""));
    expect(h).toEqual({ host: "p", "x-forwarded-for": "192.168.0.39" });
  });

  it("proxy em loopback é confiável por padrão (nginx no mesmo host)", () => {
    const h = forged();
    sanitizeClientIpHeaders(h, "127.0.0.1", parseTrustProxy(""));
    expect(h["x-real-ip"]).toBe("6.6.6.6");
  });

  it("TRUST_PROXY com IPs/CIDRs, true e false", () => {
    const list = parseTrustProxy("172.17.0.1, 10.10.0.0/16");
    expect(list("172.17.0.1")).toBe(true);
    expect(list("10.10.3.4")).toBe(true);
    expect(list("172.17.0.2")).toBe(false);
    expect(list("::1")).toBe(true);
    expect(parseTrustProxy("true")("8.8.8.8")).toBe(true);
    expect(parseTrustProxy("false")("127.0.0.1")).toBe(false);
    expect(() => parseTrustProxy("rede")).toThrow(/TRUST_PROXY/);
  });
});
