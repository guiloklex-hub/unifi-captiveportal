import { expect, test } from "@playwright/test";

test("convidado se cadastra pelo redirect da UniFi e chega à tela de sucesso", async ({ page }) => {
  await page.goto("/guest/s/default/?id=aa:bb:cc:dd:ee:ff&ap=11:22:33:44:55:66&ssid=Guest&url=http%3A%2F%2Fexample.com%2F");
  await expect(page).toHaveURL(/\/portal\?.*site=default/);

  await page.getByLabel("Nome completo").fill("Maria Souza");
  await page.getByLabel("E-mail").fill("maria@exemplo.com");
  await page.getByLabel("Telefone (celular)").fill("11912345678");
  await page.getByLabel("CPF").fill("52998224725");
  await page.locator("input[name=acceptTerms]").check();
  await page.getByRole("button", { name: "Conectar ao Wi-Fi" }).click();

  await expect(page).toHaveURL(/\/portal\/success/);
  await expect(page.getByText("480 min")).toBeVisible();
});

test("validação do formulário aparece no idioma do navegador", async ({ page }) => {
  await page.goto("/portal?id=aa:bb:cc:dd:ee:01");
  await page.getByLabel("CPF").fill("11111111111");
  await page.getByRole("button", { name: "Conectar ao Wi-Fi" }).click();
  await expect(page.getByText("CPF inválido")).toBeVisible();
  await expect(page.getByText("É necessário aceitar os termos")).toBeVisible();
});

test("portal sem MAC mostra acesso indisponível", async ({ page }) => {
  await page.goto("/portal");
  await expect(page.getByText("Acesso indisponível")).toBeVisible();
});
