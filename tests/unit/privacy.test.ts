import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  guestRegistration: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn((args: unknown) => args),
    findFirst: vi.fn(),
  },
  termsVersion: { upsert: vi.fn(async () => ({})) },
  siteBranding: { findUnique: vi.fn(async () => null) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const privacy = await import("@/lib/privacy");
const { findReturningGuest } = await import("@/lib/portal/returning");
const { DEFAULT_SETTINGS } = await import("@/lib/settings");
const { getGuestRegistrationSchema } = await import("@/lib/validators");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

beforeEach(() => vi.clearAllMocks());

describe("versão dos termos", () => {
  it("hash estável e sensível ao conteúdo", () => {
    expect(privacy.termsHashOf("Termos v1")).toBe(privacy.termsHashOf("  Termos v1 \n"));
    expect(privacy.termsHashOf("Termos v1")).not.toBe(privacy.termsHashOf("Termos v2"));
  });

  it("arquiva o texto da versão vigente", async () => {
    const hash = await privacy.currentTermsHash({ ...DEFAULT_SETTINGS, termsOfUse: "Termos únicos 123" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prismaMock.termsVersion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hash }, create: { hash, text: "Termos únicos 123" } }),
    );
  });
});

describe("titular", () => {
  it("exige identificador completo", () => {
    expect(privacy.subjectWhere({ cpf: "123" })).toBeNull();
    expect(privacy.subjectWhere({ cpf: "529.982.247-25" })).toEqual({ OR: [{ cpf: "52998224725" }] });
    expect(privacy.subjectWhere({ email: "Ana@X.com", phone: "+1 555 123 4567" })).toEqual({
      OR: [{ email: "ana@x.com" }, { phone: "+15551234567" }],
    });
  });

  it("anonimiza PII e troca a chave de visitante, só nos ainda não anonimizados", async () => {
    prismaMock.guestRegistration.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    expect(await privacy.anonymizeRegistrations({ cpf: "52998224725" })).toBe(2);
    expect(prismaMock.guestRegistration.findMany.mock.calls[0][0].where).toEqual({ cpf: "52998224725", anonymizedAt: null });
    const data = prismaMock.guestRegistration.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ fullName: "", email: "", phone: "", cpf: "", document: null, fingerprint: null, marketingConsent: false });
    expect(data.anonymizedAt).toBeInstanceOf(Date);
    expect(prismaMock.guestRegistration.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { visitorKey: "anon:2" } });
  });
});

describe("convidado recorrente e termos", () => {
  const settings = { ...DEFAULT_SETTINGS, rememberDeviceDays: 30 };
  const last = {
    fullName: "Ana Lima",
    email: "a@x.com",
    phone: "",
    cpf: "",
    documentType: null,
    document: null,
    revokedAt: null,
    anonymizedAt: null,
    termsHash: "v1",
    marketingConsent: true,
  };

  it("reconhece quando os termos não mudaram e repassa o consentimento", async () => {
    prismaMock.guestRegistration.findFirst.mockResolvedValue(last);
    const r = await findReturningGuest("aa:bb:cc:dd:ee:ff", settings, "v1");
    expect(r?.consent).toEqual({ termsHash: "v1", marketing: true });
  });

  it("exige novo aceite quando os termos mudaram", async () => {
    prismaMock.guestRegistration.findFirst.mockResolvedValue(last);
    expect(await findReturningGuest("aa:bb:cc:dd:ee:ff", settings, "v2")).toBeNull();
  });

  it("ignora cadastros anonimizados", async () => {
    prismaMock.guestRegistration.findFirst.mockResolvedValue({ ...last, anonymizedAt: new Date() });
    expect(await findReturningGuest("aa:bb:cc:dd:ee:ff", settings, "v1")).toBeNull();
  });
});

describe("consentimento de marketing no formulário", () => {
  it("é opcional e desmarcado por padrão", () => {
    const schema = getGuestRegistrationSchema(dictionaries.pt.validation, {
      fieldName: "hidden",
      fieldEmail: "hidden",
      fieldPhone: "hidden",
      fieldDocument: "hidden",
    });
    expect(schema.parse({ acceptTerms: true, mac: "aa:bb:cc:dd:ee:ff" }).marketingConsent).toBe(false);
    expect(schema.parse({ acceptTerms: true, mac: "aa:bb:cc:dd:ee:ff", marketingConsent: true }).marketingConsent).toBe(true);
  });
});
