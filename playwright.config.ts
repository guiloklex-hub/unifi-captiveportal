import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de ponta a ponta: sobe a controladora UniFi simulada e o portal
 * (build de produção) com um banco descartável.
 *
 *   npm run build && npm run test:e2e
 *
 * PW_CHROMIUM_PATH aponta um Chromium já instalado (sem `playwright install`).
 */
const PORT = 3300;
const MOCK_PORT = 18443;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "pt-BR",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: "node scripts/mock-unifi.ts",
      env: { MOCK_PORT: String(MOCK_PORT) },
      url: `http://127.0.0.1:${MOCK_PORT}/`,
      reuseExistingServer: false,
    },
    {
      command: `rm -f prisma/e2e.db* && npx prisma migrate deploy && npx next start -p ${PORT}`,
      env: {
        DATABASE_URL: "file:./prisma/e2e.db",
        ADMIN_PASSWORD: "e2e-senha-admin",
        ADMIN_SECRET: "e2e-secret-com-pelo-menos-trinta-e-dois-caracteres",
        UNIFI_URL: `http://127.0.0.1:${MOCK_PORT}`,
        UNIFI_USERNAME: "api",
        UNIFI_PASSWORD: "pw",
        UNIFI_API_KEY: "chave-teste",
        LOG_LEVEL: "warn",
      },
      url: `http://127.0.0.1:${PORT}/api/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
