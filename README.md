# UniFi Captive Portal + BI

Portal Guest (External Portal Server) integrado com a controladora **Ubiquiti UniFi v10.1.89**, com painel administrativo, relatórios de BI, **sistema de tokens de acesso** e **customização total de branding**.

---

## ✨ Atualizações recentes (Abril 2026)

### Sistema de tokens de acesso
- **Tokens criados pelo admin** com parâmetros próprios: duração da sessão, banda (down/up Kbps), quota de dados (MB), data/hora de expiração e número máximo de usos.
- **Toggle global** "Exigir token de acesso" no painel — quando ativo, o campo aparece no formulário do guest; quando desativo, o fluxo padrão (apenas dados pessoais) é preservado.
- **Locks via `.env`** — variáveis `TOKEN_LOCK_*` travam campos individuais do formulário admin (útil para padronizar políticas em deploys multi-cliente).
- **Geração de código** com `crypto.randomBytes(12)` em base32 sem caracteres ambíguos (formato `XXXX-XXXX-XXXX`).
- **Atomicidade**: reserva de uso via raw SQL `UPDATE ... WHERE usedCount < maxUses` evita race condition entre guests competindo pelo último uso.
- **Idempotência**: re-autorização do mesmo MAC no mesmo dia não consome uso adicional do token.
- **Compensação**: se a UniFi falhar após reserva, o uso é liberado automaticamente.
- **Renovação** ("estender") — admin pode adicionar minutos à validade e/ou usos extras a tokens ainda ativos.
- **Revogação em cascata** — ao revogar um token, opção de desconectar via UniFi todos os guests ativos que o usaram.

### Multi-site UniFi
- Cada token pode ser vinculado a um site específico da controladora; valor padrão `default`.
- `authorizeGuest`, `unauthorizeGuest` e `listActiveGuests` aceitam parâmetro `site` opcional, com fallback para `UNIFI_SITE` do `.env`.

### Métricas e auditoria
- **Dashboard de tokens**: contagens por status (ativo/expirado/revogado/esgotado), tempo médio até primeiro uso, top 5 tokens mais utilizados.
- **Coluna Token nos logs** (UI + CSV) — admin enxerga qual token autorizou cada guest.
- **Endpoint de métricas dedicado** `/api/admin/tokens/metrics` para integrações.
- **Reconciliação UniFi ↔ DB** — endpoint `POST /api/admin/reconcile` atualiza `bytesTx`, `bytesRx`, `lastSeenAt` consultando `/stat/guest`.

### Segurança
- **Fingerprint do dispositivo** (SHA-256 de UA + idioma + timezone + plataforma + tela + memória) gravado em cada autorização — sinal de defesa em profundidade contra MAC spoofing. Logs de warning quando o mesmo MAC + token retorna fingerprint diferente.
- **Quota de dados** (`bytesQuotaMB`) agora persistida no `GuestRegistration` para auditoria.
- **Endpoint público de sessão** `/api/portal/session/[id]` devolve apenas dados não-sensíveis (sem PII), com janela de 5 min após autorização.

### UX
- **Tela de sucesso enriquecida** — mostra tempo restante (atualizado a cada 30s), duração total, banda, quota e SSID.
- **Máscara de token** no formulário — formatação automática `XXXX-XXXX-XXXX`, `autoCapitalize="characters"`, `spellCheck=false`.
- **Tradução completa** das novas funcionalidades para PT/EN/ES.

### Correções
- **`UniFiUnavailableError`** corretamente reconhecida em catch (estava sendo coberta apenas pelo `export {}` no fim do arquivo — confirmamos funcionalidade).
- **Filtro de payload UniFi** agora usa `typeof === "number" && > 0` em vez de truthy-coercion (`if (opts.upKbps)`), preservando intenção de "sem limite" via `0`/ausente.
- **`prisma.$executeRaw`** convertido para `Number()` antes da comparação — defesa contra drivers que retornem `bigint`.
- **Idempotência da reserva de token** — refresh do navegador / retentativa no mesmo dia não consome usos extras.

---

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript
- **React 19** + `react-hook-form` + `zod`
- **Tailwind CSS** + componentes shadcn/ui
- **Prisma 7** + SQLite (via `@prisma/adapter-better-sqlite3`)
- **Recharts** para gráficos BI
- **react-markdown** para termos de uso formatados
- **undici** para chamadas HTTPS à controladora (suporte a TLS self-signed, circuit breaker, retry com backoff exponencial e mutex de login)
- **PM2** para gerenciamento de processo em produção
- **i18n nativo** via Dictionaries (sem dependências externas pesadas) — PT/EN/ES

---

## 🌍 Suporte a idiomas (i18n)

Detecção automática pelo cabeçalho `Accept-Language`. Idiomas: 🇧🇷 PT, 🇺🇸 EN, 🇪🇸 ES.

Tradução cobre:
- Fluxo do **Portal Guest** (formulários, validações Zod, termos de uso, tela de sucesso).
- **Painel Administrativo** completo (menus, dashboard, logs, sessões, customização, **gerenciamento de tokens**).
- **Tela de sucesso enriquecida** — labels de duração, banda, quota e tempo restante.
- Formatação de datas e números pela localidade.

---

## Pré-requisitos

- Ubuntu / Debian (ou derivado)
- Acesso `sudo`
- Controladora UniFi v10.1.89 acessível na rede
- Node 24.x

---

## 1. Instalação do ambiente

### 1.1 Preparação do Sistema Operacional (Debian / Ubuntu)

```bash
apt update && apt upgrade -y
apt install -y sudo curl git build-essential libcap2-bin
```

> O `libcap2-bin` libera a porta 80 para o Node sem precisar rodar como root; `git` clona o projeto e `curl` baixa o Node.

### 1.2 Instalar o NVM (Node Version Manager)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm --version
```

### 1.3 Instalar o Node.js (Versão 24.x)

```bash
nvm install 24
nvm use 24
nvm alias default 24

node --version   # v24.x.x
npm --version    # 11.x.x ou superior
```

### 1.4 Permitir que o Node escute na porta 80 sem root

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

> Repita esse comando sempre que atualizar a versão do Node.

### 1.5 Instalar o PM2 globalmente

```bash
npm install -g pm2
pm2 --version
```

---

## 2. Clonar e configurar o projeto

```bash
git clone https://github.com/guiloklex-hub/unifi-captiveportal
cd unifi-captiveportal
```

### 2.1 Criar o arquivo de variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Consulte a seção **Variáveis de ambiente** abaixo para detalhes.

### 2.2 Instalar dependências

```bash
npm install
```

### 2.3 Aplicar migrações

```bash
npx prisma migrate deploy
```

> Em desenvolvimento, use `npx prisma migrate dev` para criar e aplicar interativamente.

---

## 3. Build e execução com PM2

### 3.1 Build de produção

```bash
npm run build
```

### 3.2 Iniciar com PM2

```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs unifi-portal --lines 20
```

### 3.3 Inicialização automática no boot

```bash
pm2 startup        # execute o comando que aparecer (sudo env PATH=...)
pm2 save
```

### 3.4 Comandos PM2 do dia a dia

```bash
pm2 status
pm2 logs unifi-portal
pm2 restart unifi-portal      # após alterar .env
pm2 reload unifi-portal       # zero-downtime
pm2 stop unifi-portal
pm2 delete unifi-portal
```

---

## 4. Atualização e manutenção

### 4.1 git pull para baixar atualizações

```bash
cd unifi-captiveportal
git pull origin main
npm install
npx prisma migrate deploy     # aplica migrações novas
npm run build
pm2 reload unifi-portal       # zero downtime
```

### 4.2 Reset total

```bash
pm2 delete unifi-portal
cd ..
rm -rf unifi-captiveportal
git clone https://github.com/guiloklex-hub/unifi-captiveportal
cd unifi-captiveportal
# siga seções 2 e 3
```

### 4.3 Reconciliação UniFi ↔ DB

Para popular `bytesTx/bytesRx/lastSeenAt` periodicamente, agende um cron:

```bash
# /etc/cron.d/unifi-reconcile — executa a cada 5 minutos
*/5 * * * * root curl -s -X POST http://127.0.0.1/api/admin/reconcile > /dev/null
```

> Para reconciliar um site específico: `POST /api/admin/reconcile?site=<nome-do-site>`.

---

## 5. Variáveis de ambiente

Todas ficam no arquivo `.env`.

### 5.1 Núcleo

| Variável | Obrigatório | Descrição | Exemplo |
|---|---|---|---|
| `DATABASE_URL` | Sim | Caminho do SQLite | `file:./prisma/dev.db` |
| `UNIFI_URL` | Sim | URL da controladora | `https://192.168.1.1:8443` |
| `UNIFI_USERNAME` | Sim | Usuário admin local UniFi | `portal-api` |
| `UNIFI_PASSWORD` | Sim | Senha do usuário UniFi | `SenhaForte123` |
| `UNIFI_SITE` | Não | Site UniFi padrão (multi-site supported via tokens) | `default` |
| `UNIFI_INSECURE_TLS` | Não | `true` aceita certificado self-signed | `true` |
| `GUEST_DURATION_MIN` | Não | Duração padrão (minutos), usada quando guest autoriza sem token | `480` |
| `GUEST_DOWN_KBPS` | Não | Limite de download padrão (Kbps) | `5120` |
| `GUEST_UP_KBPS` | Não | Limite de upload padrão (Kbps) | `2048` |
| `PORTAL_SUCCESS_URL` | Não | Redirect após autorização | `https://empresa.com.br` |
| `ADMIN_PASSWORD` | Sim | Senha do painel admin | `SenhaForte@2026` |
| `ADMIN_SECRET` | Sim | Segredo HMAC para sessão (mín. 16 chars) | *(gerar)* |
| `COOKIE_SECURE` | Não | `true` somente com HTTPS | `false` |

**Gerar `ADMIN_SECRET`:**

```bash
openssl rand -hex 32
```

### 5.2 AdGuard Home (opcional)

| Variável | Descrição |
|---|---|
| `ADGUARD_URL` | URL do AdGuard Home |
| `ADGUARD_USER` / `ADGUARD_PASSWORD` | Credenciais |

### 5.3 Locks de token (opcional)

Quando definidas, **travam** o campo correspondente no painel admin (formulário de criação de token e checkbox de Customização). Os tokens criados passarão a usar **sempre** o valor da variável, sobrescrevendo o que o cliente envia. Vazia ou ausente = campo editável.

| Variável | Efeito |
|---|---|
| `TOKEN_LOCK_REQUIRE` | `true`/`false` — força o checkbox "Exigir token" |
| `TOKEN_LOCK_DURATION_MIN` | Trava duração da sessão em N minutos |
| `TOKEN_LOCK_MAX_USES` | Trava número máximo de usos |
| `TOKEN_LOCK_DOWN_KBPS` | Trava limite download (use `0` para travar como "sem limite") |
| `TOKEN_LOCK_UP_KBPS` | Trava limite upload |
| `TOKEN_LOCK_BYTES_QUOTA_MB` | Trava quota de dados |
| `TOKEN_LOCK_EXPIRES_IN_MIN` | Trava validade em janela relativa (minutos da criação) |

> **Defesa server-side**: a aplicação reaplica os locks no `POST /api/admin/tokens` para que clientes adulterados não consigam contornar.

---

## 6. Configurando a controladora UniFi

### 6.1 Criar usuário dedicado para a API

1. Acesse o painel da controladora UniFi.
2. Vá em **Settings → Admins → Add New Admin**.
3. Marque **Restrict to local access** e defina permissão **Site Admin**.
4. Insira credenciais em `UNIFI_USERNAME` / `UNIFI_PASSWORD` no `.env`.

### 6.2 Configurar o External Portal Server

1. Vá em **Settings → Profiles → Guest Hotspot** (ou **Hotspot** dependendo da versão).
2. Em **Authentication Methods → One Way Methods**, marque **External Portal Server** e clique em **Edit**.
3. No campo **External Portal**, informe o IP do servidor:

   ```
   IP_DO_SERVIDOR
   ```

   > A controladora redireciona o cliente para `http://IP_DO_SERVIDOR/guest/s/default/?id=<MAC>&...`

4. Clique em **Save**.

### 6.3 Configurar a rede Guest

1. Vá em **Settings → Networks**, selecione/crie a rede Wi-Fi Guest.
2. Garanta que o perfil **Guest Hotspot** acima está associado à rede.

### 6.4 Walled Garden (Pre-Authorization Access)

Em **Pre-Authorization Access**, adicione `IP_DO_SERVIDOR:80` (e quaisquer domínios externos usados em logos/backgrounds).

> [!IMPORTANT]
> Recomenda-se **upload local** (em vez de URLs externas) para evitar dependência de domínios em pré-autenticação.

### 6.5 Fluxo end-to-end

```
1. Cliente conecta na SSID Guest e tenta navegar
2. UniFi redireciona para http://IP_DO_SERVIDOR/guest/s/default/?id=<MAC>&ap=<APMAC>&ssid=<SSID>&url=<originalUrl>
3. App redireciona para /portal
4. Cliente preenche dados (e o token, se requireToken=true)
5. Backend valida → reserva token (atomic) → autoriza UniFi → persiste no SQLite
6. Cliente é redirecionado para /portal/success com tempo restante, banda e quota visíveis
7. Após delay, redirect para PORTAL_SUCCESS_URL ou URL original
```

---

## 7. Sistema de tokens de acesso

### 7.1 Quando ativar

O modo "tokens" é útil quando o operador quer:
- Distribuir credenciais nominais (ex: visitantes do dia, terceirizados, parceiros).
- Aplicar limites diferentes por categoria (executivo vs estagiário vs evento).
- Ter **rastreabilidade** de quem autorizou cada guest.
- Limitar o número de pessoas simultâneas que podem usar uma mesma "credencial".

Quando desativado, o portal funciona em modo livre (qualquer guest preenche dados pessoais e é liberado).

### 7.2 Fluxo do admin

1. **Painel Admin → Customização** → marque **"Exigir token de acesso"** e salve.
2. **Painel Admin → Tokens → Criar token**:
   - **Descrição** (livre, ex.: "Reunião cliente XPTO 30/04").
   - **Duração da sessão (min)** — sobrescreve `GUEST_DURATION_MIN`.
   - **Máx. de usos** — quantos guests podem usar esse mesmo token.
   - **Limite download/upload (Kbps)** — opcional, em branco = sem limite.
   - **Quota de dados (MB)** — opcional, sem limite se vazio.
   - **Site UniFi** — `default` ou nome do site específico.
   - **Validade**: janela relativa (1h/6h/24h/7d/30d) ou data/hora específica.
3. Após criar, o sistema exibe o **código** uma única vez em destaque (`XXXX-XXXX-XXXX`), com botão **Copiar**.
4. Distribua o código para o(s) guest(s).

### 7.3 Fluxo do guest

1. Acessa `/portal` (ou é redirecionado pela UniFi).
2. Preenche **Nome**, **E-mail**, **Telefone**, **CPF** e **Token de acesso**.
3. O sistema valida o token (existe, não revogado, não expirado, com usos disponíveis) e aplica os limites do token na chamada `authorize-guest` da UniFi.
4. O `usedCount` do token é incrementado atomicamente; o `GuestRegistration` é vinculado via `tokenId`.

### 7.4 Operações de gerenciamento

- **Estender**: adiciona minutos à validade e/ou usos extras (botão "Estender" na tabela).
- **Revogar**: marca `revokedAt`. Pergunta também se quer desconectar via UniFi os guests ainda ativos que usaram esse token.
- **Excluir**: hard delete, **apenas** se o token nunca foi usado (`usedCount === 0`). Caso contrário, a opção mostra "revogue em vez de excluir" para preservar auditoria.
- **Filtrar**: por status (ativo/expirado/revogado/esgotado) e busca textual em código/descrição.

### 7.5 Status derivado

| Status | Condição |
|---|---|
| `revoked` | `revokedAt IS NOT NULL` |
| `expired` | `expiresAt <= now` |
| `exhausted` | `usedCount >= maxUses` |
| `active` | nenhum dos acima |

### 7.6 Locks por `.env`

Vide seção **5.3** para travar campos individuais. Útil em ambientes onde o operador admin não deve poder alterar políticas (ex.: SLA de banda contratado).

### 7.7 Dashboard de tokens

`/admin` exibe (quando há ≥ 1 token):
- Contagens por status
- **Tempo médio até primeiro uso** (TTFU médio em minutos)
- **Top 5 tokens mais utilizados**

API: `GET /api/admin/tokens/metrics`.

---

## 8. Customização e branding

Painel Admin → **Customização**:

- **Nome da Marca**
- **Logotipo** (upload local ou URL externa)
- **Plano de fundo**
- **Cor primária** (hex)
- **Termos de uso** (Markdown, modal otimizado para mobile)
- **Exigir token de acesso** (toggle)

---

## 9. Acessando o sistema

| Interface | URL |
|---|---|
| Portal Guest | `http://IP_DO_SERVIDOR/portal` |
| Painel Admin | `http://IP_DO_SERVIDOR/admin` |

A senha admin é `ADMIN_PASSWORD` do `.env`.

---

## 10. Estrutura do projeto

```
unifi-captive-portal/
├── prisma/
│   ├── schema.prisma                 # GuestRegistration, AccessToken, SystemSettings
│   └── migrations/                   # Histórico de migrações
├── public/
│   └── uploads/                      # Imagens enviadas pelo admin
├── src/
│   ├── app/
│   │   ├── guest/s/[site]/           # Captura redirect UniFi
│   │   ├── portal/                   # Formulário e tela de sucesso
│   │   ├── admin/
│   │   │   ├── page.tsx              # Dashboard (com métricas de tokens)
│   │   │   ├── logs/                 # Logs de autorizações (com coluna Token)
│   │   │   ├── sessions/             # Sessões UniFi ativas
│   │   │   ├── tokens/               # CRUD de tokens
│   │   │   └── settings/             # Customização + toggle requireToken
│   │   └── api/
│   │       ├── portal/authorize/     # Autorização do guest (núcleo)
│   │       ├── portal/session/[id]/  # Detalhes não-PII para tela de sucesso
│   │       ├── admin/tokens/         # CRUD + metrics + locks
│   │       ├── admin/reconcile/      # Reconciliação UniFi ↔ DB
│   │       ├── admin/logs/           # Listagem + CSV (com Token)
│   │       └── admin/settings/
│   ├── components/
│   │   ├── portal/                   # PortalForm, TermsModal
│   │   └── admin/                    # Tabelas, charts, StatCards
│   └── lib/
│       ├── unifi.ts                  # Cliente UniFi (multi-site, circuit breaker)
│       ├── auth.ts                   # Sessão admin via HMAC
│       ├── settings.ts               # SystemSettings com requireToken
│       ├── tokens.ts                 # Geração, validação, reserva atômica
│       ├── tokenLocks.ts             # Locks via .env
│       ├── tokenValidators.ts        # Schemas Zod (create/extend)
│       ├── reconcile.ts              # Reconciliação UniFi ↔ DB
│       ├── fingerprint.ts            # Fingerprint client-side (SHA-256)
│       ├── masks.ts
│       ├── validators.ts             # Esquema Zod parametrizável (requireToken)
│       └── i18n/dictionaries.ts      # PT/EN/ES
└── .env.example
```

---

## 11. Endpoints da API UniFi utilizados

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/login` ou `/api/auth/login` | POST | Login (Classic ou UniFi OS — detecção automática) |
| `/api/s/{site}/cmd/stamgr` | POST | `authorize-guest` e `unauthorize-guest` |
| `/api/s/{site}/stat/guest` | GET | Lista guests ativos com `tx_bytes`, `rx_bytes` etc. |

Recursos do cliente em [src/lib/unifi.ts](src/lib/unifi.ts):

- Detecção automática **UniFi OS vs Classic** por probe.
- **Mutex de login** evita relogin concorrente.
- **Circuit breaker**: 5 falhas consecutivas → 30s "open".
- **Retry** com backoff exponencial (500ms, 1500ms) em 5xx, abort, timeout.
- **CSRF rotativo**: header `x-updated-csrf-token` é capturado e reaproveitado.
- **Defesa contra HTML 200**: se a controladora devolver HTML em sucesso (sessão invalidada silenciosa), invalida cache e força relogin.
- **Multi-site**: parâmetro `site` opcional em todas as funções; fallback para `UNIFI_SITE` do `.env`, depois `"default"`.

---

## 12. Endpoints da aplicação

### Públicos (guest)

| Endpoint | Método | Descrição |
|---|---|---|
| `/portal` | GET | Formulário do captive portal |
| `/portal/success` | GET | Tela de sucesso com detalhes da sessão |
| `/api/portal/authorize` | POST | Valida token, autoriza UniFi, persiste guest. Rate-limit 10 req/min/IP |
| `/api/portal/session/[id]` | GET | Detalhes não-PII da sessão (janela 5min) |

### Administrativos

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/admin/login` | POST | Login (gera cookie HMAC) |
| `/api/admin/logout` | POST | Logout |
| `/api/admin/settings` | GET/POST | Branding + toggle requireToken |
| `/api/admin/logs` | GET | Listagem paginada + CSV (inclui token) |
| `/api/admin/guests/active` | GET | Sessões UniFi ativas |
| `/api/admin/guests/revoke` | POST | Desconecta guest específico |
| `/api/admin/tokens` | GET/POST | Lista/cria tokens |
| `/api/admin/tokens/[id]` | PATCH/DELETE | Revoga (com cascade), estende ou exclui |
| `/api/admin/tokens/locks` | GET | Devolve quais campos estão travados via `.env` |
| `/api/admin/tokens/metrics` | GET | Agregados para dashboard |
| `/api/admin/reconcile` | POST | Reconciliação UniFi ↔ DB (cron-friendly) |
| `/api/admin/dns-logs` | GET | Atividade DNS via AdGuard Home |
| `/api/admin/upload` | POST | Upload de imagens (logo/background) |

---

## 13. Banco de dados

SQLite criado em `prisma/dev.db` na primeira migração.

**Modelo `GuestRegistration`** — registros de autorização: nome, e-mail, telefone, CPF, MAC, site UniFi, fingerprint, limites aplicados (downKbps/upKbps/bytesQuotaMB/durationMin), uso medido (bytesTx/bytesRx/lastSeenAt/reconciledAt), token vinculado.

**Modelo `AccessToken`** — code, descrição, limites, maxUses/usedCount, expiresAt, revokedAt, firstUsedAt, site.

**Modelo `SystemSettings`** — singleton com branding e `requireToken`.

```bash
npx prisma studio    # abre UI em http://localhost:5555
```

---

## 14. Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| Logo não aparece em mobile | Bloqueio de URL externa | Faça **Upload Local** em Customização |
| Portal redireciona mas não abre | IP bloqueado na UniFi | Adicione o IP em **Pre-Authorization Access** |
| `Failed to compile` no build | Tipagem ou pasta ausente | Garanta que `public/uploads` existe e tem write |
| Token "esgotado" no segundo acesso do mesmo guest | Idempotência por `(mac, authDate, tokenId)` resolve isso desde 04/2026 | Atualize: `git pull && npm install && npx prisma migrate deploy` |
| `usedCount` não decrementa após falha UniFi | `releaseTokenUse` só roda quando UniFi falha **após** reserva | Cheque logs PM2 — pode ser falha no banco antes da reserva |
| `requireToken` não pode ser desmarcado no painel | `TOKEN_LOCK_REQUIRE` setado no `.env` | Comente a linha no `.env` e reinicie o PM2 |
| Métricas de tokens não aparecem no dashboard | Nenhum token criado ainda | Crie um token em `/admin/tokens` |
| Reconciliação não atualiza bytes | Cron não configurado | Veja seção **4.3** |

---

## 15. LGPD e segurança

- **Termos de uso**: modal com rolagem; aceite registrado por guest.
- **Mínimo necessário**: a tela de sucesso lê via endpoint dedicado que **não devolve** CPF, e-mail, telefone — apenas duração, banda, quota, SSID.
- **Tokens em texto plano no DB**: aceito como tradeoff (curta validade, baixo blast radius). Recomenda-se cifrar o disco do servidor.
- **HMAC** assina o cookie de sessão admin (TTL 12h, `httpOnly`, `sameSite=lax`).
- **Rate limit**: 10 req/min/IP em `/api/portal/authorize`.
- **`COOKIE_SECURE=true`** em produção HTTPS.

---

## 16. Roadmap

Funcionalidades planejadas (não entregues nesta versão):

- Auth real do `/api/admin/*` via Next.js middleware (hoje só `/admin/*` via `proxy.ts`).
- 2FA (TOTP) para o painel admin.
- Bulk-create de tokens com export CSV.
- QR Code do token (deep-link `/portal?token=...`).
- Templates / presets de token.
- Self-service por SSO (Google/Microsoft).
- Webhooks de eventos de token (criado/usado/revogado/esgotado).
- Trade-off de SQLite → Postgres + Redis quando passar de single-instance.
