/**
 * Controladora UniFi simulada para desenvolvimento/demonstração sem hardware.
 *
 *   npm run mock:unifi                      # UniFi OS + API oficial na porta 8443
 *   MOCK_VARIANT=classic npm run mock:unifi # Network Application clássica
 *
 * Credenciais: usuário "api" / senha "pw" / API Key "chave-teste".
 * Aponte o portal com UNIFI_URL=http://127.0.0.1:8443.
 */
import { MockUnifi } from "../tests/helpers/mockUnifi.ts";

const variant = process.env.MOCK_VARIANT === "classic" ? "classic" : "unifi-os";
const port = Number(process.env.MOCK_PORT ?? 8443);

const mock = new MockUnifi({
  variant,
  username: "api",
  password: "pw",
  apiKey: "chave-teste",
  integration: variant === "unifi-os",
  integrationFilter: true,
  legacyAcceptsApiKey: variant === "unifi-os",
  version: process.env.MOCK_VERSION ?? "10.1.89",
});

const url = await mock.start(port);
console.log(`Mock UniFi (${variant}) em ${url} — usuário api / senha pw / API Key chave-teste`);
