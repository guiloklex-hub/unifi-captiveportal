import { describe, expect, it } from "vitest";
import {
  ADMIN_SECRET_PLACEHOLDER,
  DOCKER_DATABASE_URL,
  preflight,
  shellExport,
} from "../../scripts/docker-preflight.mts";

const SECRET = "a".repeat(64);
const ok = { DATABASE_URL: DOCKER_DATABASE_URL, ADMIN_SECRET: SECRET, ADMIN_PASSWORD: "senha" };

describe("docker preflight", () => {
  it("ambiente correto passa sem exports nem avisos", () => {
    expect(preflight(ok)).toEqual({ exports: {}, warnings: [], errors: [] });
  });

  it("remove aspas que o docker run --env-file mantém", () => {
    const r = preflight({ ...ok, ADMIN_PASSWORD: '"Senha@1"', UNIFI_SITE: "'default'" });
    expect(r.exports).toEqual({ ADMIN_PASSWORD: "Senha@1", UNIFI_SITE: "default" });
    expect(r.warnings[0]).toContain("ADMIN_PASSWORD");
    expect(r.errors).toEqual([]);
  });

  it("não mexe em aspas que não fecham o valor", () => {
    expect(preflight({ ...ok, ADMIN_PASSWORD: '"abc', X: 'a"b"' }).exports).toEqual({});
  });

  it("DATABASE_URL relativo (do .env.example) vira o banco do volume /data", () => {
    const r = preflight({ ...ok, DATABASE_URL: '"file:./prisma/dev.db"' });
    expect(r.exports.DATABASE_URL).toBe(DOCKER_DATABASE_URL);
    expect(r.errors).toEqual([]);
  });

  it("ADMIN_SECRET do exemplo, curto ou ausente impede a subida", () => {
    expect(preflight({ ...ok, ADMIN_SECRET: `"${ADMIN_SECRET_PLACEHOLDER}"` }).errors).toHaveLength(1);
    expect(preflight({ ...ok, ADMIN_SECRET: "curto" }).errors[0]).toContain("5 caracteres");
    expect(preflight({ ...ok, ADMIN_SECRET: undefined }).errors).toHaveLength(1);
  });

  it("avisa quando ADMIN_PASSWORD é o valor de exemplo", () => {
    expect(preflight({ ...ok, ADMIN_PASSWORD: "trocar-essa-senha" }).warnings).toHaveLength(1);
  });

  it("shellExport escapa aspas simples e $", () => {
    expect(shellExport("P", "a'b$c")).toBe("export P='a'\\''b$c'");
  });
});
