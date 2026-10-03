import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Prisma em memória (apenas o que as rotas usam) ──────────────────────────
type Row = Record<string, unknown> & { id: string };
const otpRows = new Map<string, Row>();
const oauthRows = new Map<string, Row>();
let seq = 0;

const prismaMock = {
  otpChallenge: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `ch${++seq}`, attempts: 0, preAuth: false, createdAt: new Date(), verifiedAt: null, ...data } as Row;
      otpRows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = otpRows.get(where.id)!;
      for (const [k, v] of Object.entries(data)) {
        row[k] = typeof v === "object" && v && "increment" in v ? (row[k] as number) + (v as { increment: number }).increment : v;
      }
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; verifiedAt: null }; data: Record<string, unknown> }) => {
      const row = otpRows.get(where.id);
      if (!row || row.verifiedAt) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => otpRows.get(where.id) ?? null),
    findFirst: vi.fn(async ({ where }: { where: { OR: { mac?: string; destination?: string }[] } }) => {
      const rows = [...otpRows.values()].filter((r) =>
        where.OR.some((c) => (c.mac !== undefined && r.mac === c.mac) || (c.destination !== undefined && r.destination === c.destination)),
      );
      return rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null;
    }),
    count: vi.fn(async ({ where }: { where: { mac?: string; preAuth?: boolean; destination?: string } }) =>
      [...otpRows.values()].filter(
        (r) =>
          (where.mac === undefined || r.mac === where.mac) &&
          (where.preAuth === undefined || r.preAuth === where.preAuth) &&
          (where.destination === undefined || r.destination === where.destination),
      ).length,
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => otpRows.delete(where.id)),
  },
  oAuthLogin: {
    create: vi.fn(async ({ data }: { data: Row }) => {
      oauthRows.set(data.id, { ...data });
      return data;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; ticket?: string } }) =>
      where.id ? oauthRows.get(where.id) ?? null : [...oauthRows.values()].find((r) => r.ticket === where.ticket) ?? null,
    ),
    updateMany: vi.fn(async ({ where, data }: { where: { ticket: string }; data: Record<string, unknown> }) => {
      const row = [...oauthRows.values()].find((r) => r.ticket === where.ticket && !r.usedAt);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const settingsRef = { current: {} as Record<string, unknown> };
vi.mock("@/lib/settings", async (orig) => {
  const mod = await orig<typeof import("@/lib/settings")>();
  return { ...mod, getSystemSettings: vi.fn(async () => ({ ...mod.DEFAULT_SETTINGS, ...settingsRef.current })) };
});

const sendEmail = vi.fn();
const sendSms = vi.fn();
vi.mock("@/lib/messaging/email", () => ({ sendEmail, emailConfigured: () => true }));
vi.mock("@/lib/messaging/sms", () => ({ sendSms, smsConfigured: () => true }));

const authorizeGuest = vi.fn();
vi.mock("@/lib/unifi", async () => ({ ...(await import("@/lib/unifi/errors")), authorizeGuest }));

vi.mock("@/lib/privacy", () => ({ currentTermsHash: vi.fn(async () => "termos-v1") }));

const grantGuestAccess = vi.fn();
vi.mock("@/lib/portal/grantAccess", () => ({ grantGuestAccess }));

const otpStart = await import("@/app/api/portal/otp/start/route");
const otpVerify = await import("@/app/api/portal/otp/verify/route");
const authorize = await import("@/app/api/portal/authorize/route");
const otp = await import("@/lib/portal/otp");
const oauth = await import("@/lib/portal/oauth");

const form = {
  fullName: "Maria Souza",
  email: "maria@exemplo.com",
  phone: "11912345678",
  cpf: "52998224725",
  acceptTerms: true,
  mac: "aa:bb:cc:dd:ee:ff",
};

const post = (body: unknown) =>
  new NextRequest("http://portal.local/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": `10.0.0.${++seq}` },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  otpRows.clear();
  oauthRows.clear();
  settingsRef.current = {};
  grantGuestAccess.mockResolvedValue({ ok: true, id: 7, redirect: null });
  authorizeGuest.mockResolvedValue(undefined);
});

describe("helpers de OTP", () => {
  it("gera 6 dígitos e mascara o destino", () => {
    expect(otp.generateOtpCode()).toMatch(/^\d{6}$/);
    expect(otp.maskDestination("email", "maria@exemplo.com")).toBe("ma•••@exemplo.com");
    expect(otp.maskDestination("sms", "11912345678")).toBe("•••• 5678");
  });

  it("hash depende do desafio (mesmo código, desafios diferentes)", () => {
    expect(otp.hashOtp("a", "123456")).not.toBe(otp.hashOtp("b", "123456"));
  });
});

describe("fluxo de verificação por e-mail", () => {
  it("autorização direta é recusada quando a verificação está ligada", async () => {
    settingsRef.current = { verificationMode: "email" };
    const res = await authorize.POST(post(form));
    expect(res.status).toBe(403);
    expect(grantGuestAccess).not.toHaveBeenCalled();
  });

  it("envia o código, libera acesso provisório e autoriza após o código certo", async () => {
    settingsRef.current = { verificationMode: "email", otpPreAuthMinutes: 10 };
    const start = await otpStart.POST(post(form));
    expect(start.status).toBe(200);
    const body = await start.json();
    expect(body).toMatchObject({ channel: "email", destination: "ma•••@exemplo.com", preAuthMinutes: 10 });
    expect(authorizeGuest).toHaveBeenCalledWith(expect.objectContaining({ mac: "aa:bb:cc:dd:ee:ff", minutes: 10 }));

    const code = /(\d{6})/.exec(sendEmail.mock.calls[0][2])![1];

    const wrong = await otpVerify.POST(post({ challengeId: body.challengeId, code: code === "000000" ? "111111" : "000000", mac: form.mac }));
    expect(wrong.status).toBe(400);

    const ok = await otpVerify.POST(post({ challengeId: body.challengeId, code, mac: form.mac }));
    expect(ok.status).toBe(200);
    expect(grantGuestAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        authMethod: "otp-email",
        identity: expect.objectContaining({ email: "maria@exemplo.com" }),
        // Versão dos termos aceita no envio do formulário segue até o registro final.
        consent: { termsHash: "termos-v1", marketing: false },
      }),
      expect.anything(),
      expect.anything(),
    );

    // Código de uso único.
    const again = await otpVerify.POST(post({ challengeId: body.challengeId, code, mac: form.mac }));
    expect(again.status).toBe(400);
  });

  it("bloqueia após 5 tentativas erradas", async () => {
    settingsRef.current = { verificationMode: "sms" };
    const body = await (await otpStart.POST(post(form))).json();
    const code = /(\d{6})/.exec(sendSms.mock.calls[0][1])![1];
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await otpVerify.POST(post({ challengeId: body.challengeId, code: wrong, mac: form.mac }));
    const res = await otpVerify.POST(post({ challengeId: body.challengeId, code, mac: form.mac }));
    expect((await res.json()).reason).toBe("too_many_attempts");
  });

  it("código de outro MAC não vale", async () => {
    settingsRef.current = { verificationMode: "sms" };
    const body = await (await otpStart.POST(post(form))).json();
    const code = /(\d{6})/.exec(sendSms.mock.calls[0][1])![1];
    const res = await otpVerify.POST(post({ challengeId: body.challengeId, code, mac: "11:11:11:11:11:11" }));
    expect(res.status).toBe(400);
  });

  it("respeita o intervalo de reenvio", async () => {
    settingsRef.current = { verificationMode: "sms" };
    await otpStart.POST(post(form));
    const res = await otpStart.POST(post(form));
    expect(res.status).toBe(429);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("trocar o MAC não burla o intervalo de reenvio para o mesmo telefone", async () => {
    settingsRef.current = { verificationMode: "sms" };
    await otpStart.POST(post(form));
    const res = await otpStart.POST(post({ ...form, mac: "02:00:00:00:00:01" }));
    expect(res.status).toBe(429);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("no máximo 5 códigos por destinatário em 24 h, mesmo com MACs diferentes", async () => {
    settingsRef.current = { verificationMode: "sms" };
    const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
    for (let i = 0; i < otp.OTP_MAX_PER_DESTINATION_PER_DAY; i++) {
      const res = await otpStart.POST(post({ ...form, mac: `02:00:00:00:00:1${i}` }));
      expect(res.status).toBe(200);
      // Envelhece os desafios para sair do intervalo de reenvio, mas dentro das 24 h.
      for (const row of otpRows.values()) row.createdAt = anHourAgo();
    }
    const res = await otpStart.POST(post({ ...form, mac: "02:00:00:00:00:99" }));
    expect(res.status).toBe(429);
    expect(sendSms).toHaveBeenCalledTimes(otp.OTP_MAX_PER_DESTINATION_PER_DAY);
  });

  it("falha no envio devolve 502 e não deixa desafio pendurado", async () => {
    settingsRef.current = { verificationMode: "email" };
    sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    const res = await otpStart.POST(post(form));
    expect(res.status).toBe(502);
    expect(otpRows.size).toBe(0);
  });
});

describe("login social", () => {
  const clientId = "client-123";
  const nonce = "n-1";
  const iss = "https://accounts.google.com";
  const claims = { aud: clientId, iss, exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "Ana@Gmail.com", email_verified: true, name: "Ana Lima" };
  const expected = { clientId, nonce, issuerOk: (i: string) => i === iss };

  it("valida claims do id_token", () => {
    expect(oauth.validateIdTokenClaims("google", claims, expected)).toEqual({ name: "Ana Lima", email: "ana@gmail.com" });
    expect(() => oauth.validateIdTokenClaims("google", { ...claims, aud: "outro" }, expected)).toThrow("aud");
    expect(() => oauth.validateIdTokenClaims("google", { ...claims, nonce: "x" }, expected)).toThrow("nonce");
    expect(() => oauth.validateIdTokenClaims("google", { ...claims, exp: 1 }, expected)).toThrow("expirado");
    expect(() => oauth.validateIdTokenClaims("google", { ...claims, email_verified: false }, expected)).toThrow();
  });

  it("Microsoft usa preferred_username quando não há email", () => {
    const ms = { ...claims, email: undefined, email_verified: undefined, preferred_username: "joao@empresa.com" };
    expect(oauth.validateIdTokenClaims("microsoft", ms, expected).email).toBe("joao@empresa.com");
  });

  it("só oferece provedores ligados, configurados e com URL HTTPS", () => {
    const base = { socialGoogle: true, socialMicrosoft: true } as Parameters<typeof oauth.availableProviders>[0];
    process.env.GOOGLE_CLIENT_ID = "g";
    process.env.GOOGLE_CLIENT_SECRET = "s";
    process.env.PUBLIC_PORTAL_URL = "http://inseguro.local";
    expect(oauth.availableProviders(base)).toEqual([]);
    process.env.PUBLIC_PORTAL_URL = "https://wifi.hotel.com";
    expect(oauth.availableProviders(base)).toEqual(["google"]);
  });

  it("gera URL de autorização com PKCE e state persistido", async () => {
    const url = new URL(
      await oauth.startOAuthLogin("google", { mac: "aa:bb:cc:dd:ee:ff", apMac: null, ssid: null, site: null, originalUrl: null }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://wifi.hotel.com/api/portal/oauth/callback");
    expect(oauthRows.has(url.searchParams.get("state")!)).toBe(true);
  });

  it("ticket social: nome/e-mail do provedor substituem os do formulário e dispensam o código", async () => {
    settingsRef.current = { verificationMode: "email" };
    oauthRows.set("st", {
      id: "st",
      provider: "google",
      context: JSON.stringify({ mac: form.mac }),
      expiresAt: new Date(Date.now() + 60_000),
      name: "Ana Lima",
      email: "ana@gmail.com",
      ticket: "tk1",
      usedAt: null,
    });
    const res = await authorize.POST(post({ ...form, fullName: "Outro Nome", socialTicket: "tk1" }));
    expect(res.status).toBe(200);
    expect(grantGuestAccess.mock.calls[0][0]).toMatchObject({
      authMethod: "google",
      identity: { fullName: "Ana Lima", email: "ana@gmail.com" },
    });
    // Uso único
    const again = await authorize.POST(post({ ...form, socialTicket: "tk1" }));
    expect(again.status).toBe(400);
  });
});
