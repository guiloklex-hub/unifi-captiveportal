import { describe, expect, it } from "vitest";
import { clientIp, rateLimit } from "@/lib/rateLimit";

describe("rateLimit", () => {
  it("bloqueia após o máximo na janela", () => {
    const key = `test:${Math.random()}`;
    expect(rateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 2, 60_000).allowed).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefere CF-Connecting-IP, depois X-Real-IP, depois último hop do XFF", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
