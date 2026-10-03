import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type User = Record<string, unknown> & { id: string; username: string };
const users = new Map<string, User>();

const prismaMock = {
  adminUser: {
    count: vi.fn(async () => users.size),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; username?: string } }) =>
      [...users.values()].find((u) => (where.id ? u.id === where.id : u.username === where.username)) ?? null,
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const u = users.get(where.id)!;
      for (const [k, v] of Object.entries(data)) {
        u[k] = typeof v === "object" && v && "increment" in v ? (u[k] as number) + (v as { increment: number }).increment : v;
      }
      return u;
    }),
  },
  auditLog: { create: vi.fn(async () => ({})) },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { passwordLogin, mfaLogin } = await import("@/lib/admin/login");
const { getAdminSession, invalidateAdminSessions } = await import("@/lib/admin/session");
const { hashPassword } = await import("@/lib/admin/password");
const { encryptSecret } = await import("@/lib/crypto");
const { generateTotpSecret, totp } = await import("@/lib/admin/totp");
const { proxy } = await import("@/proxy");
const { ADMIN_COOKIE } = await import("@/lib/auth");

async function addUser(p: Partial<User> & { username: string; password: string }) {
  const u: User = {
    id: `u${users.size + 1}`,
    role: "admin",
    disabled: false,
    failedLogins: 0,
    lockedUntil: null,
    totpEnabled: false,
    totpSecretEnc: null,
    sessionVersion: 0,
    ...p,
    passwordHash: await hashPassword(p.password),
  };
  users.set(u.id, u);
  return u;
}

beforeEach(() => {
  users.clear();
  invalidateAdminSessions();
  process.env.ADMIN_PASSWORD = "senha-legada";
  delete process.env.ADMIN_BREAK_GLASS;
  delete process.env.ADMIN_ALLOWED_NETWORKS;
  delete process.env.CRON_SECRET;
});

describe("login legado (bootstrap)", () => {
  it("vale só enquanto não há usuários", async () => {
    const r = await passwordLogin("", "senha-legada");
    expect(r.status).toBe("ok");
    const session = await getAdminSession(r.status === "ok" ? r.token : "");
    expect(session).toMatchObject({ username: "admin", role: "admin", legacy: true });

    await addUser({ username: "maria", password: "Senha12345x" });
    invalidateAdminSessions();
    expect((await passwordLogin("", "senha-legada")).status).toBe("invalid");
    // A sessão legada aberta também deixa de valer.
    expect(await getAdminSession(r.status === "ok" ? r.token : "")).toBeNull();
  });

  it("ADMIN_BREAK_GLASS reabre o acesso de emergência", async () => {
    await addUser({ username: "maria", password: "Senha12345x" });
    process.env.ADMIN_BREAK_GLASS = "true";
    expect((await passwordLogin("admin", "senha-legada")).status).toBe("ok");
  });
});

describe("login com usuário", () => {
  it("senha correta gera sessão com papel; senha errada falha", async () => {
    await addUser({ username: "joao", password: "Senha12345x", role: "operator" });
    expect((await passwordLogin("joao", "errada")).status).toBe("invalid");
    const r = await passwordLogin("JOAO", "Senha12345x");
    expect(r.status).toBe("ok");
    expect(await getAdminSession(r.status === "ok" ? r.token : "")).toMatchObject({ username: "joao", role: "operator" });
  });

  it("bloqueia após 5 falhas", async () => {
    await addUser({ username: "ana", password: "Senha12345x" });
    for (let i = 0; i < 5; i++) await passwordLogin("ana", "errada");
    expect((await passwordLogin("ana", "Senha12345x")).status).toBe("locked");
  });

  it("usuário desativado não entra e perde a sessão", async () => {
    const u = await addUser({ username: "bia", password: "Senha12345x" });
    const r = await passwordLogin("bia", "Senha12345x");
    u.disabled = true;
    invalidateAdminSessions();
    expect(await getAdminSession(r.status === "ok" ? r.token : "")).toBeNull();
    expect((await passwordLogin("bia", "Senha12345x")).status).toBe("invalid");
  });

  it("troca de senha (sessionVersion) derruba sessões antigas", async () => {
    const u = await addUser({ username: "caio", password: "Senha12345x" });
    const r = await passwordLogin("caio", "Senha12345x");
    u.sessionVersion = 1;
    invalidateAdminSessions();
    expect(await getAdminSession(r.status === "ok" ? r.token : "")).toBeNull();
  });

  it("2FA: senha leva ao passo MFA e o código conclui", async () => {
    const secret = generateTotpSecret();
    const u = await addUser({ username: "dani", password: "Senha12345x", totpEnabled: true, totpSecretEnc: encryptSecret(secret) });
    const first = await passwordLogin("dani", "Senha12345x");
    expect(first).toEqual({ status: "mfa", uid: u.id });
    expect((await mfaLogin(u.id, "000000")).status).toBe(totp(secret) === "000000" ? "ok" : "invalid");
    const ok = await mfaLogin(u.id, totp(secret));
    expect(ok.status).toBe("ok");
  });
});

describe("proxy com RBAC", () => {
  async function tokenFor(role: "admin" | "operator" | "viewer") {
    await addUser({ username: role, password: "Senha12345x", role });
    const r = await passwordLogin(role, "Senha12345x");
    return r.status === "ok" ? r.token : "";
  }

  function req(path: string, method: string, token?: string) {
    return new NextRequest(`http://portal.local${path}`, {
      method,
      headers: {
        host: "portal.local",
        origin: "http://portal.local",
        ...(token ? { cookie: `${ADMIN_COOKIE}=${token}` } : {}),
        "x-admin-user": "forjado",
      },
    });
  }

  it("sem sessão: API 401 e página redireciona ao login", async () => {
    expect((await proxy(req("/api/admin/tokens", "GET"))).status).toBe(401);
    const page = await proxy(req("/admin/logs", "GET"));
    expect(page.headers.get("location")).toContain("/admin/login?next=%2Fadmin%2Flogs");
  });

  it("leitura não muta; operador não acessa áreas de admin", async () => {
    const viewer = await tokenFor("viewer");
    expect((await proxy(req("/api/admin/tokens", "GET", viewer))).status).toBe(200);
    expect((await proxy(req("/api/admin/tokens", "POST", viewer))).status).toBe(403);

    const operator = await tokenFor("operator");
    expect((await proxy(req("/api/admin/tokens", "POST", operator))).status).toBe(200);
    expect((await proxy(req("/api/admin/users", "GET", operator))).status).toBe(403);

    const admin = await tokenFor("admin");
    expect((await proxy(req("/api/admin/users", "POST", admin))).status).toBe(200);
  });

  it("identidade repassada às rotas é a da sessão, não a enviada pelo cliente", async () => {
    const operator = await tokenFor("operator");
    const res = await proxy(req("/api/admin/tokens", "GET", operator));
    expect(res.headers.get("x-middleware-request-x-admin-user")).toBe("operator");
    expect(res.headers.get("x-middleware-request-x-admin-role")).toBe("operator");
  });

  it("CSRF: mutação sem Origin do mesmo host é recusada", async () => {
    const admin = await tokenFor("admin");
    const bad = new NextRequest("http://portal.local/api/admin/users", {
      method: "POST",
      headers: { host: "portal.local", origin: "http://evil.com", cookie: `${ADMIN_COOKIE}=${admin}` },
    });
    expect((await proxy(bad)).status).toBe(403);
  });
});

describe("ADMIN_ALLOWED_NETWORKS", () => {
  const from = (ip: string, path = "/admin/login") =>
    new NextRequest(`http://portal.local${path}`, { headers: { host: "portal.local", "x-forwarded-for": ip } });

  it("vazio: painel acessível de qualquer rede", async () => {
    expect((await proxy(from("192.168.0.50"))).status).toBe(200);
  });

  it("fora das redes: 404 em páginas e APIs, inclusive a tela de login", async () => {
    process.env.ADMIN_ALLOWED_NETWORKS = "10.35.10.0/24, 10.35.48.2";
    expect((await proxy(from("192.168.0.50"))).status).toBe(404);
    expect((await proxy(from("192.168.0.50", "/api/admin/login"))).status).toBe(404);
    expect((await proxy(from("10.35.10.20"))).status).toBe(200);
    expect((await proxy(from("10.35.48.2"))).status).toBe(200);
    expect((await proxy(from("10.35.48.3"))).status).toBe(404);
    // Loopback sempre liberado (cron local); IPv4 mapeado em IPv6 é normalizado.
    expect((await proxy(from("127.0.0.1"))).status).toBe(200);
    expect((await proxy(from("::ffff:10.35.10.20"))).status).toBe(200);
  });

  it("entrada inválida é recusada com mensagem clara", async () => {
    const { parseNetworks } = await import("@/lib/adminNetworks");
    expect(() => parseNetworks("10.0.0.0/33")).toThrow(/ADMIN_ALLOWED_NETWORKS/);
    expect(() => parseNetworks("rede-interna")).toThrow(/rede-interna/);
  });
});

describe("CRON_SECRET", () => {
  const SECRET = "c".repeat(32);
  const cron = (path: string, method = "POST") =>
    new NextRequest(`http://portal.local${path}`, {
      method,
      headers: { host: "portal.local", authorization: `Bearer ${SECRET}` },
    });

  it("vale só para limpeza e relatório — não abre o resto do painel", async () => {
    process.env.CRON_SECRET = SECRET;
    expect((await proxy(cron("/api/admin/cleanup"))).status).toBe(200);
    expect((await proxy(cron("/api/admin/reports/send"))).status).toBe(200);
    expect((await proxy(cron("/api/admin/users", "GET"))).status).toBe(401);
    // Sem Origin e sem sessão: o CSRF barra antes.
    expect((await proxy(cron("/api/admin/users"))).status).toBe(403);
  });
});

describe("tempo de resposta do login", () => {
  it("usuário inexistente também paga o scrypt (não revela quais usuários existem)", async () => {
    await addUser({ username: "maria", password: "Senha12345x" });
    await passwordLogin("ninguem", "x"); // aquece o hash de fachada
    const time = async (u: string) => {
      const t = performance.now();
      for (let i = 0; i < 3; i++) await passwordLogin(u, "senha-errada");
      return performance.now() - t;
    };
    const existing = await time("maria");
    const missing = await time("ninguem");
    expect(missing).toBeGreaterThan(existing * 0.5);
  });
});
