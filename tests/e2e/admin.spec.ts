import { expect, test, type Page } from "@playwright/test";

async function loginLegacy(page: Page, next = "/admin") {
  await page.goto(`/admin/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Senha").fill("e2e-senha-admin");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(`**${next}`);
}

test("rotas do painel exigem login", async ({ page, request }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fusers/);
  expect((await request.get("/api/admin/tokens")).status()).toBe(401);
});

test("login de primeiro acesso, criação de token e folha de vouchers", async ({ page }) => {
  await loginLegacy(page, "/admin/tokens");
  await expect(page.getByText("senha única do .env")).toBeVisible();

  // O mesmo rótulo abre o formulário e o envia (o botão de abrir vira "Cancelar").
  await page.getByRole("button", { name: "Criar token" }).click();
  await page.getByLabel("Quantidade (vouchers em lote)").fill("3");
  await page.getByRole("button", { name: "Criar token" }).click();
  await expect(page.getByText("3 vouchers criados")).toBeVisible();

  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Imprimir vouchers" }).click(),
  ]);
  await expect(print.locator(".voucher")).toHaveCount(3);
});

test("tela de conexão UniFi diagnostica a controladora simulada", async ({ page }) => {
  await loginLegacy(page, "/admin/unifi");
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByText("UniFi OS", { exact: true })).toBeVisible();
  await expect(page.getByText("API oficial (API Key)").first()).toBeVisible();
  await expect(page.getByText("10.1.89")).toBeVisible();
});

test("primeiro usuário encerra a senha legada", async ({ page, request }) => {
  await loginLegacy(page, "/admin/users");
  page.on("dialog", (d) => d.accept());
  await page.getByLabel("Usuário").fill("gerente");
  await page.getByLabel("Senha").fill("SenhaForte2026");
  await page.getByRole("button", { name: "Criar usuário" }).click();
  await page.waitForURL("**/admin/login**");

  const legacy = await request.post("/api/admin/login", {
    data: { password: "e2e-senha-admin" },
    headers: { origin: "http://127.0.0.1:3300" },
  });
  expect(legacy.status()).toBe(401);

  await page.getByLabel("Usuário").fill("gerente");
  await page.getByLabel("Senha").fill("SenhaForte2026");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/account/);
});
