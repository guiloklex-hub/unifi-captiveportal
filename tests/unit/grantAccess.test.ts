import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  guestRegistration: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  accessToken: { updateMany: vi.fn() },
  systemSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  siteBranding: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const authorizeGuest = vi.fn();
vi.mock("@/lib/unifi", async () => {
  const errors = await import("@/lib/unifi/errors");
  return { ...errors, authorizeGuest };
});

const { grantGuestAccess } = await import("@/lib/portal/grantAccess");
const { defaultGuestPolicy } = await import("@/lib/settings");
const { findReturningGuest } = await import("@/lib/portal/returning");
const { dictionaries } = await import("@/lib/i18n/dictionaries");
const { UniFiUnavailableError, UniFiClientError } = await import("@/lib/unifi/errors");

const dict = dictionaries.pt;
const baseSettings = {
  brandName: "X",
  logoUrl: null,
  backgroundUrl: null,
  primaryColor: "#000000",
  termsOfUse: "",
  requireToken: false,
  singleDeviceByCpf: false,
  defaultDurationMin: 90,
  defaultDownKbps: 0,
  defaultUpKbps: null,
  defaultQuotaMB: 200,
  fieldName: "required" as const,
  fieldEmail: "required" as const,
  fieldPhone: "required" as const,
  fieldDocument: "required" as const,
  allowForeignDocument: false,
  rememberDeviceDays: 0,
};

const request = {
  identity: { fullName: "Ana Lima", email: "ana@x.com", phone: "11912345678", cpf: "", documentType: "passport", document: "AB12345" },
  mac: "AA:BB:CC:DD:EE:FF",
  apMac: null,
  ssid: "Guest",
  site: "evento",
  originalUrl: "https://example.com/a?b=c",
  fingerprint: null,
  authMethod: "form" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.guestRegistration.upsert.mockResolvedValue({ id: 42 });
  authorizeGuest.mockResolvedValue(undefined);
  process.env.GUEST_UP_KBPS = "1024";
  delete process.env.PORTAL_SUCCESS_URL;
});

describe("defaultGuestPolicy", () => {
  it("painel tem precedência; null cai no .env; 0 = sem limite", () => {
    expect(defaultGuestPolicy(baseSettings)).toEqual({ minutes: 90, downKbps: undefined, upKbps: 1024, bytesQuotaMB: 200 });
  });
});

describe("grantGuestAccess", () => {
  it("autoriza com a política padrão e grava visitorKey/authMethod", async () => {
    const res = await grantGuestAccess(request, baseSettings, dict);
    expect(res).toEqual({ ok: true, id: 42, redirect: "https://example.com/a" });
    expect(authorizeGuest).toHaveBeenCalledWith({
      mac: "aa:bb:cc:dd:ee:ff",
      minutes: 90,
      downKbps: undefined,
      upKbps: 1024,
      bytesQuotaMB: 200,
      apMac: null,
      site: "evento",
    });
    const { create } = prismaMock.guestRegistration.upsert.mock.calls[0][0];
    expect(create).toMatchObject({ visitorKey: "doc:AB12345", authMethod: "form", document: "AB12345", cpf: "" });
  });

  it("bloqueio de CPF ignora cadastros sem CPF", async () => {
    await grantGuestAccess(request, { ...baseSettings, singleDeviceByCpf: true }, dict);
    expect(prismaMock.guestRegistration.findMany).not.toHaveBeenCalled();
  });

  it("bloqueio de CPF recusa outro dispositivo com sessão viva", async () => {
    prismaMock.guestRegistration.findMany.mockResolvedValue([
      { id: 1, macAddress: "11:11:11:11:11:11", authorizedAt: new Date(), durationMin: 60 },
    ]);
    const res = await grantGuestAccess(
      { ...request, identity: { ...request.identity, cpf: "52998224725" } },
      { ...baseSettings, singleDeviceByCpf: true },
      dict,
    );
    expect(res).toEqual({ ok: false, status: 409, error: dict.validation.valCpfAlreadyActive });
    expect(authorizeGuest).not.toHaveBeenCalled();
  });

  it("controladora fora do ar → mensagem de indisponibilidade", async () => {
    authorizeGuest.mockRejectedValue(new UniFiUnavailableError("down"));
    const res = await grantGuestAccess(request, baseSettings, dict);
    expect(res).toEqual({ ok: false, status: 502, error: dict.portal.errServiceUnavailable });
  });

  it("payload recusado → mensagem de falha de autorização", async () => {
    authorizeGuest.mockRejectedValue(new UniFiClientError(400, "bad"));
    const res = await grantGuestAccess(request, baseSettings, dict);
    expect(res).toEqual({ ok: false, status: 502, error: dict.portal.errAuthorizeFailed });
  });
});

describe("findReturningGuest", () => {
  const settings = { ...baseSettings, rememberDeviceDays: 30 };

  it("desligado com rememberDeviceDays=0 ou token exigido", async () => {
    expect(await findReturningGuest("aa:bb:cc:dd:ee:ff", baseSettings)).toBeNull();
    expect(await findReturningGuest("aa:bb:cc:dd:ee:ff", { ...settings, requireToken: true })).toBeNull();
    expect(prismaMock.guestRegistration.findFirst).not.toHaveBeenCalled();
  });

  it("reconhece o dispositivo e expõe só o primeiro nome", async () => {
    prismaMock.guestRegistration.findFirst.mockResolvedValue({ ...request.identity, revokedAt: null });
    const r = await findReturningGuest("AA:BB:CC:DD:EE:FF", settings);
    expect(r?.firstName).toBe("Ana");
    expect(r?.identity).toEqual(request.identity);
    expect(prismaMock.guestRegistration.findFirst.mock.calls[0][0].where.macAddress).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("não reconhece quando a última sessão foi revogada pelo admin", async () => {
    prismaMock.guestRegistration.findFirst.mockResolvedValue({ ...request.identity, revokedAt: new Date() });
    expect(await findReturningGuest("aa:bb:cc:dd:ee:ff", settings)).toBeNull();
  });
});
