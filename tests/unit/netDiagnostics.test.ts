import { describe, expect, it } from "vitest";
import { findSubnetConflict, networkErrorDetail } from "@/lib/unifi/netDiagnostics";

describe("networkErrorDetail", () => {
  it("expõe o código da causa do 'fetch failed'", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect EHOSTUNREACH 172.18.1.2:8443"), { code: "EHOSTUNREACH" }),
    });
    expect(networkErrorDetail(err)).toBe(
      "fetch failed — EHOSTUNREACH: host inalcançável: não há rota até a controladora a partir deste servidor",
    );
  });

  it("reconhece timeout de conexão do undici e erros de TLS", () => {
    const timeout = new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
    expect(networkErrorDetail(timeout)).toContain("tempo de conexão esgotado");
    const tls = new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ERR_SSL_WRONG_VERSION_NUMBER" }) });
    expect(networkErrorDetail(tls)).toBe("fetch failed — ERR_SSL_WRONG_VERSION_NUMBER: falha no TLS");
  });

  it("mantém a mensagem quando não há código", () => {
    expect(networkErrorDetail(new Error("HTTP 502"))).toBe("HTTP 502");
    expect(networkErrorDetail("boom")).toBe("boom");
  });
});

describe("findSubnetConflict", () => {
  const dockerIface = { address: "172.18.0.2", netmask: "255.255.0.0", family: "IPv4", internal: false };
  const lo = { address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true };

  it("detecta controladora dentro da rede do container", () => {
    expect(findSubnetConflict("172.18.1.2", [lo, dockerIface])).toBe("172.18.0.0/16");
  });

  it("ignora IPs fora da sub-rede, hostnames e loopback", () => {
    expect(findSubnetConflict("192.168.1.10", [lo, dockerIface])).toBeNull();
    expect(findSubnetConflict("unifi.local", [dockerIface])).toBeNull();
    expect(findSubnetConflict("127.0.0.5", [lo])).toBeNull();
  });
});
