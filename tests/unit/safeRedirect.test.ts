import { describe, expect, it } from "vitest";
import { safeAdminNextPath, sanitizeGuestRedirect } from "@/lib/safeRedirect";
import { contrastForeground } from "@/lib/utils";

describe("safeAdminNextPath", () => {
  it("mantém caminhos internos do painel", () => {
    expect(safeAdminNextPath("/admin/logs?site=x")).toBe("/admin/logs?site=x");
  });

  it("bloqueia open redirect e javascript:", () => {
    expect(safeAdminNextPath("https://evil.com")).toBe("/admin");
    expect(safeAdminNextPath("//evil.com")).toBe("/admin");
    expect(safeAdminNextPath("/\\evil.com")).toBe("/admin");
    expect(safeAdminNextPath("javascript:alert(1)")).toBe("/admin");
    expect(safeAdminNextPath(null)).toBe("/admin");
  });
});

describe("sanitizeGuestRedirect", () => {
  it("remove querystring e aceita só http(s)", () => {
    expect(sanitizeGuestRedirect("https://site.com/a?token=1#x")).toBe("https://site.com/a");
    expect(sanitizeGuestRedirect("javascript:alert(1)")).toBeNull();
    expect(sanitizeGuestRedirect("não é url")).toBeNull();
  });
});

describe("contrastForeground", () => {
  it("escolhe texto legível sobre a cor da marca", () => {
    expect(contrastForeground("#171717")).toBe("#ffffff");
    expect(contrastForeground("#fde047")).toBe("#0a0a0a");
    expect(contrastForeground("inválido")).toBe("#ffffff");
  });
});
