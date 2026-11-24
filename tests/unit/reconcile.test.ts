import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UniFiGuest } from "@/lib/unifi";

const prismaMock = {
  guestRegistration: { findMany: vi.fn(), update: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const listActiveGuests = vi.fn<(site?: string | null, opts?: { withTraffic?: boolean }) => Promise<UniFiGuest[]>>();
vi.mock("@/lib/unifi", () => ({ listActiveGuests, lastStatsStrategy: () => "integration" }));

const { latestGuestByMac, reconcileActiveSessions } = await import("@/lib/reconcile");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.guestRegistration.findMany.mockResolvedValue([
    { id: 7, macAddress: "aa:bb:cc:dd:ee:ff" },
    { id: 3, macAddress: "aa:bb:cc:dd:ee:ff" },
  ]);
  prismaMock.guestRegistration.update.mockResolvedValue({});
});

describe("latestGuestByMac", () => {
  it("fica com a autorização mais recente de cada MAC, qualquer que seja a ordem", () => {
    const m = latestGuestByMac([
      { mac: "AA:BB:CC:DD:EE:FF", start: 200, tx_bytes: 5, rx_bytes: 50 },
      { mac: "aa:bb:cc:dd:ee:ff", start: 100, tx_bytes: 1, rx_bytes: 1, expired: true },
    ]);
    expect(m.size).toBe(1);
    expect(m.get("aa:bb:cc:dd:ee:ff")?.rx_bytes).toBe(50);
  });

  it("no empate, prefere o registro com contadores", () => {
    const m = latestGuestByMac([
      { mac: "aa:bb:cc:dd:ee:ff", start: 100, tx_bytes: 5, rx_bytes: 50 },
      { mac: "aa:bb:cc:dd:ee:ff", start: 100 },
    ]);
    expect(m.get("aa:bb:cc:dd:ee:ff")?.rx_bytes).toBe(50);
  });
});

describe("reconcileActiveSessions", () => {
  it("pede o tráfego e grava os bytes no registro mais recente do MAC", async () => {
    listActiveGuests.mockResolvedValue([{ mac: "aa:bb:cc:dd:ee:ff", tx_bytes: 1000, rx_bytes: 2000 }]);
    const r = await reconcileActiveSessions();

    expect(listActiveGuests).toHaveBeenCalledWith(undefined, { withTraffic: true });
    expect(r).toMatchObject({ ok: true, active: 1, updated: 1, withTraffic: 1, strategy: "integration" });
    const call = prismaMock.guestRegistration.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 7 });
    expect(call.data).toMatchObject({ bytesTx: 1000n, bytesRx: 2000n });
    expect(call.data.reconciledAt).toBeInstanceOf(Date);
  });

  it("sem contadores na fonte, mantém os bytes já gravados (não zera para null)", async () => {
    listActiveGuests.mockResolvedValue([{ mac: "aa:bb:cc:dd:ee:ff", authorized: true }]);
    const r = await reconcileActiveSessions();

    expect(r).toMatchObject({ ok: true, updated: 1, withTraffic: 0 });
    const data = prismaMock.guestRegistration.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("bytesTx");
    expect(data).not.toHaveProperty("bytesRx");
    expect(data).not.toHaveProperty("reconciledAt");
    expect(data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("falha da controladora vira ok:false com a mensagem", async () => {
    listActiveGuests.mockRejectedValue(new Error("UniFi indisponível"));
    const r = await reconcileActiveSessions("default");
    expect(r).toMatchObject({ ok: false, error: "UniFi indisponível", updated: 0 });
    expect(prismaMock.guestRegistration.update).not.toHaveBeenCalled();
  });
});
