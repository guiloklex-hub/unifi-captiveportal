# Integrações

Tudo fica em **Painel → Integrações** (somente administradores).

## Webhooks

O portal envia um `POST` JSON para cada evento assinado:

| Evento | Quando | `data` |
|---|---|---|
| `guest.authorized` | Convidado liberado (qualquer forma de acesso) | `registrationId`, `authorizedAt`, `mac`, `ip`, `site`, `ssid`, `apMac`, `authMethod`, `durationMin`, `downKbps`, `upKbps`, `bytesQuotaMB`, `tokenId`, `marketingConsent` (+ `fullName`, `email`, `phone`, `cpf`, `documentType`, `document` se "incluir dados pessoais") |
| `guest.revoked` | Admin desconectou um convidado | `mac`, `site`, `revokedBy`, `revokedAt` |
| `rule.created` | Bloqueio/liberação criado | `kind`, `matchType`, `reason`, `expiresAt`, `createdBy` (+ `value` com dados pessoais) |

Corpo:

```json
{ "event": "guest.authorized", "id": "0f7c…", "createdAt": "2026-09-26T19:10:38.000Z", "data": { "mac": "aa:bb:…" } }
```

Cabeçalhos:

| Cabeçalho | Conteúdo |
|---|---|
| `X-Portal-Event` | nome do evento |
| `X-Portal-Delivery` | id único da entrega (use para idempotência) |
| `X-Portal-Timestamp` | epoch em segundos |
| `X-Portal-Signature` | `sha256=` + HMAC-SHA256(segredo, `"<timestamp>.<corpo bruto>"`) |

Entrega assíncrona com até 3 tentativas (imediata, +5 s, +30 s). Respostas 4xx (exceto 429) não são repetidas. O resultado da última entrega aparece no painel, com botão **Testar**.

### Verificando a assinatura (Node.js)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(req, rawBody, secret) {
  const ts = req.headers["x-portal-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // anti-replay: 5 min
  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const got = String(req.headers["x-portal-signature"] ?? "");
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

### CRMs e e-mail marketing

Use **n8n**, **Make** ou **Zapier** para receber o webhook e enviar a **RD Station**, **HubSpot**, **Mailchimp**, planilhas etc. Para marketing, filtre por `marketingConsent = true` (LGPD).

## API pública (v1)

Autenticação: `Authorization: Bearer ucp_<prefixo>_<segredo>` — crie a chave no painel (ela aparece uma única vez; só o hash é guardado). Limite: 120 requisições/min por chave.

| Escopo | Libera |
|---|---|
| `read` | `GET /api/v1/metrics`, `GET /api/v1/sessions`, `GET /api/v1/registrations` (sem dados pessoais) |
| `read:pii` | tudo de `read` + dados pessoais em `/registrations` |
| `write` | `POST /api/v1/vouchers`, `POST /api/v1/devices/authorize` |

### `GET /api/v1/metrics?days=30&site=`

Agregados do período: `connections`, `uniqueVisitors`, `newVisitors`, `marketingConsents`, `bytesTotal`, `byDay[]`, `byMethod{}`, `bySite{}`.

### `GET /api/v1/registrations?since=&until=&site=&limit=100&cursor=`

Cadastros em ordem crescente de `id`. Pagine com `cursor=<nextCursor>` até `nextCursor` vir `null`. Datas em ISO 8601.

### `GET /api/v1/sessions?site=`

Convidados conectados agora (dados da controladora): `mac`, `ip`, `ssid`, `apMac`, `startedAt`, `endsAt`, `bytesTx`, `bytesRx`.

### `POST /api/v1/vouchers`

Mesmo corpo da criação de tokens no painel:

```json
{ "description": "Check-in quarto 101", "durationMin": 1440, "maxUses": 2, "expiresAt": "2026-12-31T23:59:00Z", "site": "default", "quantity": 1 }
```

Útil para o **PMS do hotel** gerar o voucher no check-in.

### `POST /api/v1/devices/authorize`

```json
{ "mac": "aa:bb:cc:dd:ee:ff", "minutes": 43200, "site": "default", "label": "TV quarto 101" }
```

Libera um aparelho sem navegador direto na UniFi.

## Relatório por e-mail

Configure frequência (diária ou semanal às segundas) e destinatários no painel, com SMTP no `.env`. Agende o cron **diário** — o endpoint decide se é dia de envio:

```bash
# /etc/cron.d/unifi-portal-report — todo dia às 08:05
5 8 * * * root curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1/api/admin/reports/send
```

O botão **Enviar agora** força o envio (útil para testar).
