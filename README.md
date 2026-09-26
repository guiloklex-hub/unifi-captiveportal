# UniFi Captive Portal + BI

Portal Guest (External Portal Server) integrado com a controladora **Ubiquiti UniFi v10.1.89**, com painel administrativo, relatórios de BI, **sistema de tokens de acesso** e **customização total de branding**.

---

## ✨ Atualizações recentes (Junho 2026)

### QR Code do token (deep-link)
- Cada token agora tem um **QR code** disponível no painel admin (`/admin/tokens`).
- Escanear o QR abre o portal já com o campo "Token de acesso" preenchido — o convidado só precisa completar nome/email/CPF.
- Endpoint: `GET /api/admin/tokens/{id}/qr` (SVG por padrão; `?format=png` para PNG). Header `X-Token-DeepLink` retorna a URL embutida.
- Deep-link gerado: `${PUBLIC_PORTAL_URL ?? host}/guest/s/{site}?token={code}`. Configure `PUBLIC_PORTAL_URL` (seção 5.1) com o domínio público para que o QR aponte para a URL real que o convidado consegue acessar.
- Adiciona dependência `qrcode` (~50KB) + `@types/qrcode`.

### Indicadores ao vivo no dashboard
- Nova seção `LiveCounters` no topo de `/admin` com 4 KPIs que se atualizam a cada 15s:
  - **Tokens emitidos · 24h** — `accessToken.count` na janela.
  - **Dispositivos online agora** — `listActiveGuests()` direto na controladora (graceful fallback para `—` quando a UniFi está down, não derruba o painel).
  - **Tráfego processado · 24h** — soma de `bytesTx + bytesRx` em `GuestRegistration` na janela.
  - **Uptime do serviço** — `process.uptime()`.
- Endpoint: `GET /api/admin/live-metrics`.

### Filtro multi-site no painel
- Dropdown `SiteFilter` no topo de `/admin`, `/admin/logs` e `/admin/sessions`. Lista sites distintos derivados de `GuestRegistration.site` ∪ `AccessToken.site`.
- Estado vive na query string (`?site=event-2026`), persiste entre navegações no admin. Selecionar "Todos os sites" remove o filtro.
- `/api/admin/logs?site=...` (e CSV) aplicam o filtro; `/admin/sessions?site=...` repassa para `listActiveGuests(site)`; o dashboard propaga o filtro para todas as queries Prisma de `GuestRegistration` e `AccessToken`.
- Endpoint: `GET /api/admin/sites` retorna `{ sites: [...] }`.

---

## ✨ Atualizações recentes (Maio 2026)

### Dashboard ampliado — BI mais rico (sem novas dependências)
- **Painel de tráfego (últimos 30 dias)** — totais de download/upload reconciliados, média por sessão, série temporal em `AreaChart` empilhada (TX/RX) e **top 10 consumidores** por CPF (nome, CPF mascarado, volume, sessões).
- **Heatmap hora × dia da semana** — grade 7×24 com gradação de cor por intensidade, tooltips por célula. Substitui a leitura "linear" do pie de horários de pico por uma visualização de padrões semanais.
- **Análise de dispositivos** — três donuts (sistema operacional, navegador, tipo de dispositivo) gerados via parser regex de `userAgent` em [src/lib/ua-parser.ts](src/lib/ua-parser.ts), sem dependência externa.
- **Fingerprint analytics** — KPIs de fingerprints únicos + média por CPF + tabela de fingerprints **suspeitos** (mesmo fingerprint observado em CPFs distintos no período → sinal de compartilhamento ou spoofing).
- **Tokens enriquecidos** — além das contagens existentes: **taxa média de aproveitamento** (`usedCount/maxUses`), **bytes consumidos por token** (últimos 30d) e lista de **tokens criados há >7d sem nenhum uso** (estoque parado para revisar antes de expirar).
- Helpers reutilizáveis: [src/lib/format.ts](src/lib/format.ts) (`formatBytes`, `maskCpf`, `bigIntToNumber`).
- Tudo computado a partir dos dados já capturados (`bytesTx/bytesRx`, `userAgent`, `fingerprint`, `tokenId`); sem novas tabelas, sem nova migration.

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

### Bloqueio de 1 dispositivo por CPF
- **Toggle global** "Limitar a 1 dispositivo por CPF" em `SystemSettings` (default desligado) — impede que o mesmo CPF autorize um segundo MAC enquanto a sessão atual estiver viva (`authorizedAt + durationMin > agora`).
- **Mesmo MAC sempre passa**: reautorização do dispositivo já registrado é idempotente (refresh, troca de dia, etc.).
- **Bypass por token**: quando `requireToken=true` e o cliente apresenta token válido, o bloqueio não se aplica — o admin já controla via emissão do token.
- **Override do admin**: botão "Liberar CPF" em `/admin/sessions` marca as sessões vivas como revogadas (`revokedAt`) e dispara `unauthorize` na UniFi (best-effort).
- **Auditoria**: campo `GuestRegistration.revokedAt` distingue revogação manual de expiração natural, sem sujar `durationMin`.

### Correções
- **`UniFiUnavailableError`** corretamente reconhecida em catch (estava sendo coberta apenas pelo `export {}` no fim do arquivo — confirmamos funcionalidade).
- **Filtro de payload UniFi** agora usa `typeof === "number" && > 0` em vez de truthy-coercion (`if (opts.upKbps)`), preservando intenção de "sem limite" via `0`/ausente.
- **`prisma.$executeRaw`** convertido para `Number()` antes da comparação — defesa contra drivers que retornem `bigint`.
- **Idempotência da reserva de token** — refresh do navegador / retentativa no mesmo dia não consome usos extras.

---

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript 6**
- **React 19** + `react-hook-form` + **Zod 4**
- **Tailwind CSS 4** (configuração CSS-first em `src/app/globals.css`) + componentes shadcn/ui + `tw-animate-css`
- **Prisma 7** + SQLite (via `@prisma/adapter-better-sqlite3`)
- **Recharts 3** para gráficos BI
- **react-markdown** para termos de uso formatados
- **undici 8** para chamadas HTTPS à controladora (suporte a TLS self-signed, circuit breaker, retry com backoff exponencial e mutex de login)
- **PM2** para gerenciamento de processo em produção
- **i18n nativo** via Dictionaries (sem dependências externas pesadas) — PT/EN/ES
- **Vitest** (testes unitários) + **ESLint 9** (flat config, `eslint-config-next`)

---

## 🧪 Desenvolvimento e qualidade

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (porta 80) |
| `npm run lint` | ESLint (flat config em `eslint.config.mjs`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes unitários (Vitest, em `tests/unit/`) |
| `npm run build` | Build de produção |

O CI (`.github/workflows/ci.yml`) roda lint, typecheck, testes, `prisma migrate deploy` e build em todo PR. O **Dependabot** (`.github/dependabot.yml`) abre PRs semanais agrupando minors/patches; majors bloqueados por incompatibilidade conhecida estão documentados no próprio arquivo.

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
- Node 24.x (mínimo 22.19 — exigido pelo `undici` 8)
- `git`, `sqlite3` (CLI, usado pelo `scripts/backup.sh`), `openssl` (gerar segredos)

---

## 1. Instalação do ambiente

### 1.1 Preparação do Sistema Operacional (Debian / Ubuntu)

```bash
apt update && apt upgrade -y
apt install -y sudo curl git build-essential libcap2-bin sqlite3 openssl
```

> - `libcap2-bin` libera a porta 80 para o Node sem precisar rodar como root.
> - `git` clona o projeto; `curl` baixa o Node.
> - `sqlite3` (CLI) é usado por `scripts/backup.sh` para snapshot atômico do banco.
> - `openssl` gera `ADMIN_SECRET` e `CRON_SECRET`.

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

**Antes de salvar, gere e cole os dois segredos:**

```bash
openssl rand -hex 32    # → cole em ADMIN_SECRET (obrigatório, mín. 32 chars)
openssl rand -hex 32    # → cole em CRON_SECRET (opcional mas necessário se for usar os crons de reconcile/cleanup/backup remoto)
```

Sem `ADMIN_SECRET` válido (≥ 32 chars), a aplicação **recusa iniciar**. Sem `CRON_SECRET`, os crons retornam `401`/`403`.

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

Para popular `bytesTx/bytesRx/lastSeenAt` periodicamente, agende um cron. Como o `crontab` **não expande** variáveis do `.env`, leia o segredo do arquivo no próprio comando:

```bash
# /etc/cron.d/unifi-reconcile — executa a cada 5 minutos
*/5 * * * * root . /opt/unifi-captiveportal/.env && \
  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1/api/admin/reconcile > /dev/null
```

> Para reconciliar um site específico: `POST /api/admin/reconcile?site=<nome-do-site>`.
> O endpoint `/api/admin/*` exige cookie de admin **ou** `Authorization: Bearer $CRON_SECRET` — defina `CRON_SECRET` no `.env` (≥ 16 chars).

### 4.4 Backup do SQLite

Snapshot atômico (suporta WAL) via `sqlite3 .backup`:

```bash
bash scripts/backup.sh        # gera ./backups/portal-YYYYMMDDTHHMMSSZ.db.gz
```

Configurável por env: `BACKUP_DIR` (default `./backups`), `BACKUP_RETENTION_DAYS` (default 14).

> **Em produção**, defina `BACKUP_DIR` num caminho **fora** do diretório do projeto (ex.: `/var/backups/unifi-portal`) para que um `rm -rf unifi-captiveportal` (seção 4.2) não destrua os backups.

Cron diário às 03:00:

```bash
# /etc/cron.d/unifi-portal-backup
0 3 * * * root cd /opt/unifi-captiveportal && \
  BACKUP_DIR=/var/backups/unifi-portal bash scripts/backup.sh \
  >> /var/log/portal-backup.log 2>&1
```

Restore: `gunzip < /var/backups/unifi-portal/portal-XYZ.db.gz > prisma/dev.db && pm2 restart unifi-portal`.

### 4.5 Retenção de logs de guest

Apaga `GuestRegistration` mais antigos que `GUEST_RETENTION_DAYS` (default **365**, mínimo 7). O default de 1 ano segue o art. 13 do Marco Civil da Internet (guarda de registros de conexão):

```bash
# Cron diário às 03:30
30 3 * * * root . /opt/unifi-captiveportal/.env && \
  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1/api/admin/cleanup > /dev/null
```

Resposta: `{ ok, retentionDays, cutoff, deleted }`.

### 4.6 Rotação de logs do PM2

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

---

## 5. Variáveis de ambiente

Todas ficam no arquivo `.env`.

### 5.1 Núcleo

| Variável | Obrigatório | Descrição | Exemplo |
|---|---|---|---|
| `DATABASE_URL` | Sim | Caminho do SQLite | `file:./prisma/dev.db` |
| `UNIFI_URL` | Sim¹ | URL da controladora | `https://192.168.1.1` (UniFi OS) / `https://192.168.1.10:8443` (Classic) |
| `UNIFI_AUTH_MODE` | Não | `auto` (padrão), `apikey` ou `password` — ver seção **6.1** | `auto` |
| `UNIFI_API_KEY` | Não² | API Key da UniFi Network (UniFi OS, Network 9+) | *(gerada na UniFi)* |
| `UNIFI_USERNAME` | Não² | Usuário admin **local** UniFi (sem MFA) | `portal-api` |
| `UNIFI_PASSWORD` | Não² | Senha do usuário UniFi | `SenhaForte123` |
| `UNIFI_SITE` | Não | Site UniFi padrão (nome curto) | `default` |
| `UNIFI_INSECURE_TLS` | Não | `true` aceita certificado self-signed | `true` |
| `DATA_ENCRYPTION_KEY` | Não | Chave (32 bytes hex/base64) para cifrar segredos salvos no banco. Se ausente, derivada do `ADMIN_SECRET` | *(openssl rand -hex 32)* |
| `UPLOAD_DIR` | Não | Diretório das imagens enviadas | `./public/uploads` |
| `GUEST_DURATION_MIN` | Não | Duração padrão (minutos), usada quando guest autoriza sem token | `480` |
| `GUEST_DOWN_KBPS` | Não | Limite de download padrão (Kbps) | `5120` |
| `GUEST_UP_KBPS` | Não | Limite de upload padrão (Kbps) | `2048` |
| `GUEST_QUOTA_MB` | Não | Cota de dados padrão (MB) | `1024` |
| `PORTAL_MAC_LOOKUP` | Não | `false` desativa a busca do MAC pelo IP quando o portal é aberto sem `?id=` (ex.: QR code) | `true` |
| `PORTAL_SUCCESS_URL` | Não | Redirect após autorização | `https://empresa.com.br` |
| `ADMIN_PASSWORD` | Sim | Senha do painel admin | `SenhaForte@2026` |
| `ADMIN_SECRET` | Sim | Segredo HMAC para sessão (mín. **32 chars** — app não inicia abaixo disso) | *(gerar)* |
| `CRON_SECRET` | Não | Bearer token para chamadas internas/cron a `/api/admin/*` (gere com `openssl rand -hex 32`). Vazio ou < 16 chars desabilita o bypass. | *(string hex 32+ chars)* |
| `GUEST_RETENTION_DAYS` | Não | Retenção dos `GuestRegistration` em dias (mínimo 7, default 365 — Marco Civil) | `365` |
| `COOKIE_SECURE` | Não | `true` somente com HTTPS | `false` |
| `PUBLIC_PORTAL_URL` | Não | URL pública (com protocolo) usada para gerar deep-links de QR de token. Se vazio, usa o `Host` da requisição admin — que pode ser interno (`127.0.0.1`) e inviável para escanear. | `https://wifi.empresa.com.br` |

¹ Pode ser configurado pelo painel em **Conexão UniFi** (tem precedência sobre o `.env`).
² Informe a API Key **ou** usuário/senha (ou ambos, no modo `auto`).

**Gerar `ADMIN_SECRET`:**

```bash
openssl rand -hex 32
```

> Mínimo **32 caracteres** (16 bytes hex). O sistema recusa iniciar com segredo mais curto.

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

### 6.1 Formas de conexão e compatibilidade

O portal fala com a controladora por três caminhos e escolhe sozinho o melhor disponível (modo `auto`):

| Estratégia | Autenticação | Onde funciona | Uso |
|---|---|---|---|
| **API oficial** (Integration API) | API Key (`X-API-KEY`) | UniFi OS com Network **9.x ou superior** | Preferida para liberar/revogar guests |
| **API legada + API Key** | API Key | UniFi OS com Network 9+ | Estatísticas de tráfego; fallback |
| **API legada + usuário/senha** | Cookie de sessão | **Todas** as versões (5.x → 10.x), UniFi OS e Network Application clássica | Compatibilidade total; fallback |

| Controladora | Recomendado |
|---|---|
| UDM / UDM Pro / UDM SE / UDR / UCG / UX / Cloud Key Gen2+ / **UniFi OS Server** (Network 9+) | `UNIFI_AUTH_MODE=auto` com **API Key** (sem senha armazenada) |
| **Network Application clássica** (self-hosted Windows/Linux, porta 8443) | Usuário e senha (`auto` ou `password`) — API Key não existe nessa variante |
| UniFi OS com Network < 9 | Usuário e senha |

Modos (`UNIFI_AUTH_MODE` ou tela **Conexão UniFi**):
- `auto` — usa a API Key quando configurada e cai para usuário/senha se a controladora não suportar. Estratégias recusadas ficam 10 min fora da rotação.
- `apikey` — somente API Key (nenhuma senha é usada nem armazenada).
- `password` — somente usuário/senha (comportamento anterior).

#### Criar uma API Key (UniFi OS, Network 9+)

1. Na UniFi Network: **Settings → Control Plane → Integrations** (em algumas versões, **UniFi OS → Settings → Integrations**).
2. **Create API Key**, dê um nome (ex.: `captive-portal`) e copie a chave (ela aparece uma única vez).
3. Cole em `UNIFI_API_KEY` no `.env` **ou** em **Painel → Conexão UniFi → API Key** e clique em **Testar conexão**.

> A chave herda as permissões do usuário que a criou. Use um administrador com acesso ao(s) site(s) do portal.

#### Criar usuário dedicado (quando usar usuário/senha)

1. Acesse o painel da controladora UniFi.
2. Vá em **Settings → Admins → Add New Admin**.
3. Marque **Restrict to local access** (conta local, **sem MFA** — contas UI.com com 2FA não conseguem logar pela API) e defina permissão **Site Admin**.
4. Insira as credenciais em `UNIFI_USERNAME` / `UNIFI_PASSWORD` no `.env` ou na tela **Conexão UniFi**.

#### Tela "Conexão UniFi" no painel

Em `/admin/unifi` é possível configurar URL, site, modo, API Key e usuário/senha **sem editar o `.env`**:
- **Testar conexão** verifica cada estratégia separadamente (sem salvar) e mostra tipo de controladora (UniFi OS/Classic), versão da Network, sites encontrados e qual estratégia será usada.
- Segredos são gravados **cifrados** (AES-256-GCM) e nunca retornam ao navegador. A chave vem de `DATA_ENCRYPTION_KEY` (ou é derivada do `ADMIN_SECRET` — ao trocar o `ADMIN_SECRET` sem `DATA_ENCRYPTION_KEY`, salve os segredos novamente).
- **Voltar a usar o .env** apaga a configuração do banco.
- Testes feitos pela tela não afetam o circuit breaker nem a sessão usada pelos convidados.

#### Controladora simulada (desenvolvimento)

Sem hardware à mão? `npm run mock:unifi` sobe uma controladora UniFi OS simulada em `http://127.0.0.1:8443` (usuário `api`, senha `pw`, API Key `chave-teste`); `MOCK_VARIANT=classic` simula a Network Application clássica.

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
- **Cor primária** (hex) — a cor do texto sobre botões é escolhida automaticamente (preto ou branco) para manter contraste legível.
- **Termos de uso** (Markdown, modal otimizado para mobile)
- **Exigir token de acesso** (toggle)

Uploads aceitam **PNG, JPEG, WebP ou GIF** até **5 MB**. O tipo é detectado pelo conteúdo do arquivo (SVG é recusado por poder conter script) e o nome é gerado pelo servidor. O diretório padrão é `public/uploads/`; use `UPLOAD_DIR` para apontar outro caminho (ex.: volume persistente).

### 8.1 Formas de acesso (todas opcionais)

Tudo fica em **Customização** e vem **desligado/idêntico ao comportamento anterior** por padrão:

| Recurso | Como ativar | O que faz |
|---|---|---|
| **Formulário configurável** | Nome, e-mail, celular e CPF/documento: *Obrigatório*, *Opcional* ou *Não pedir* | Coleta só o necessário (princípio da minimização da LGPD) |
| **Acesso rápido** | Todos os campos em *Não pedir* | O convidado só aceita os termos |
| **Estrangeiros sem CPF** | "Aceitar estrangeiros sem CPF" | Opção "Não tenho CPF": passaporte + telefone internacional (`+código do país`). Sugerida automaticamente quando o navegador não está em português |
| **Convidado recorrente** | "Lembrar dispositivos por (dias)" > 0 | Quem já se cadastrou no aparelho reconecta com **um clique** ("Bem-vindo(a) de volta, Maria!"). Não vale quando o token é exigido nem se o admin revogou a última sessão. Só o primeiro nome é exibido (MAC pode ser clonado) |
| **Perfil padrão de acesso** | Duração, download, upload e cota | Aplicado a quem entra sem token. Em branco = `GUEST_*` do `.env`; `0` = sem limite |
| **Marca por site** | "Aplicar a: Somente o site X" | Nome, logo, fundo, cor e termos diferentes por site UniFi; campos em branco herdam a marca padrão |
| **Pré-visualização** | Botão "Pré-visualizar portal" | Abre o portal como o convidado verá, com envio desativado |

O dashboard ganhou o gráfico **Formas de acesso** e passa a contar visitantes únicos por uma *chave de visitante* (CPF → documento → e-mail → MAC), que funciona com qualquer configuração de formulário.

### 8.2 Vouchers impressos

Em **Tokens → Novo token**, informe **Quantidade** (até 500) para criar um lote de tokens idênticos e clique em **Imprimir vouchers**: a folha A4 traz 8 cartões por página com QR code, código, tempo de acesso, validade e (opcional) o nome da rede Wi‑Fi. Lotes antigos podem ser reimpressos pelo botão **Imprimir lote** na lista.

> **Por que não os vouchers nativos da UniFi?** Os vouchers do Hotspot da UniFi são validados pelo portal *interno* da controladora. Com portal externo (este projeto) não há API para validar/consumir um voucher UniFi — por isso o portal usa o próprio sistema de tokens, que tem os mesmos recursos (tempo, banda, cota, usos, validade) e ainda gera QR code.

### 8.3 Portal aberto sem MAC (QR code)

Quando o celular abre o link do QR code direto na câmera, a URL não traz o `?id=<MAC>` que a controladora injeta. O portal então procura o MAC na controladora **pelo IP do cliente** e segue normalmente. Requer proxy reverso que informe o IP real (`X-Real-IP` / `X-Forwarded-For`); desative com `PORTAL_MAC_LOOKUP=false`.

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
│       ├── unifi/                    # Cliente UniFi (API Key + senha, fallback, multi-site, circuit breaker)
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

**API oficial** (`/proxy/network/integration/v1`, header `X-API-KEY`):

| Endpoint | Método | Descrição |
|---|---|---|
| `/v1/info` | GET | Versão da Network |
| `/v1/sites` | GET | Sites (`internalReference` = nome curto usado na URL do portal) |
| `/v1/sites/{siteId}/clients?filter=macAddress.eq('..')` | GET | Localiza o cliente pelo MAC (fallback: varredura paginada) |
| `/v1/sites/{siteId}/clients/{clientId}/actions` | POST | `AUTHORIZE_GUEST_ACCESS` (`timeLimitMinutes`, `rxRateLimitKbps`=download, `txRateLimitKbps`=upload, `dataUsageLimitMBytes`) e `UNAUTHORIZE_GUEST_ACCESS` |
| `/v1/sites/{siteId}/devices` | GET | Nome dos APs |

**API legada** (`/api/...` no Classic, `/proxy/network/api/...` no UniFi OS):

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/login` ou `/api/auth/login` | POST | Login (Classic ou UniFi OS — detecção automática) |
| `/api/s/{site}/cmd/stamgr` | POST | `authorize-guest` e `unauthorize-guest` |
| `/api/s/{site}/stat/guest` | GET | Guests com `tx_bytes`, `rx_bytes` etc. |
| `/api/self/sites` | GET | Sites |
| `/api/s/{site}/stat/sysinfo` | GET | Versão da Network |
| `/api/s/{site}/stat/device-basic` | GET | Nome dos APs |

Recursos do cliente em [src/lib/unifi/](src/lib/unifi/):

- **Estratégias com fallback automático** (`index.ts`): API oficial → legada com API Key → legada com senha.
- Detecção automática **UniFi OS vs Classic** por probe.
- **Mutex de login** evita relogin concorrente; **CSRF rotativo** reaproveitado.
- **Circuit breaker**: 5 falhas consecutivas → 30s "open".
- **Retry** com backoff exponencial (500ms, 1500ms) em 5xx, abort, timeout.
- **Defesa contra HTML 200**: se a controladora devolver HTML em sucesso (sessão invalidada silenciosa), força relogin.
- Estado (sessão, circuito, caches) **único por processo** — antes cada rota do Next mantinha a própria sessão.
- **Multi-site**: parâmetro `site` opcional em todas as funções (validado); fallback para o site padrão configurado.

## 12. Endpoints da aplicação

### Públicos (guest)

| Endpoint | Método | Descrição |
|---|---|---|
| `/portal` | GET | Formulário do captive portal |
| `/portal/success` | GET | Tela de sucesso com detalhes da sessão |
| `/api/portal/authorize` | POST | Valida token, autoriza UniFi, persiste guest. Rate-limit 10 req/min/IP |
| `/api/portal/session/[id]` | GET | Detalhes não-PII da sessão (janela 5min) |
| `/api/portal/reconnect` | POST | Reconexão em 1 clique de dispositivo reconhecido |

### Administrativos

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/admin/login` | POST | Login (gera cookie HMAC) |
| `/api/admin/logout` | POST | Logout |
| `/api/admin/settings` | GET/POST | Branding + toggle requireToken |
| `/api/admin/logs` | GET | Listagem paginada + CSV (inclui token) |
| `/api/admin/guests/active` | GET | Sessões UniFi ativas |
| `/api/admin/guests/revoke` | POST | Desconecta guest específico (aceita `site`) |
| `/api/admin/tokens` | GET/POST | Lista/cria tokens |
| `/api/admin/tokens/[id]` | PATCH/DELETE | Revoga (com cascade), estende ou exclui |
| `/api/admin/tokens/locks` | GET | Devolve quais campos estão travados via `.env` |
| `/api/admin/tokens/metrics` | GET | Agregados para dashboard |
| `/api/admin/reconcile` | POST | Reconciliação UniFi ↔ DB (cron-friendly) |
| `/api/admin/cleanup` | POST | Apaga GuestRegistration > `GUEST_RETENTION_DAYS` (cron) |
| `/api/admin/dns-logs` | GET | Atividade DNS via AdGuard Home |
| `/api/admin/upload` | POST | Upload de imagens (logo/background) |
| `/api/admin/unifi/connection` | GET/PUT/DELETE | Conexão UniFi salva no painel (segredos nunca retornam) |
| `/api/admin/branding/[site]` | GET/PUT/DELETE | Marca por site (campos nulos herdam a marca padrão) |
| `/admin/print/vouchers?batch=` | GET | Folha de impressão de vouchers (página) |
| `/api/admin/unifi/test` | POST | Diagnóstico da conexão (configuração atual ou rascunho do formulário) |
| `/api/admin/sites` | GET | Sites para filtros (banco ∪ controladora) |

### Operacionais

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/healthz` | GET | Status agregado (UniFi, DB, disco, versão). 200 = ok/degraded; 503 = DB ou disco caído. |

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
| `Error: ADMIN_SECRET ausente ou com menos de 32 caracteres` no boot | `.env` sem `ADMIN_SECRET` ou com valor curto | Gere com `openssl rand -hex 32` e cole no `.env`; reinicie com `pm2 restart unifi-portal` |
| Cron retorna `401 Não autorizado` ou `403 Origem inválida` | `CRON_SECRET` ausente, curto (< 16 chars) ou cron não envia o header `Authorization: Bearer` | Defina `CRON_SECRET` no `.env` (≥ 16 chars) e use o cron-exemplo da seção **4.3** que carrega a variável via `. /opt/unifi-captiveportal/.env` |
| `scripts/backup.sh` falha com "sqlite3: command not found" | CLI ausente | `sudo apt install -y sqlite3` |
| `bind EACCES 0.0.0.0:80` ao iniciar PM2 | Falta `setcap` na nova versão do Node | Refaça `sudo setcap 'cap_net_bind_service=+ep' $(which node)` (seção **1.4**) e `pm2 restart unifi-portal` |
| `Could not find a production build in .next` | `npm run build` não rodou nesse host após o `git pull` | Rode `npm run build` antes de `pm2 reload unifi-portal` (seção **4.1**) |

---

## 15. LGPD e segurança

- **Termos de uso**: modal com rolagem; aceite registrado por guest.
- **Mínimo necessário**: a tela de sucesso lê via endpoint dedicado que **não devolve** CPF, e-mail, telefone — apenas duração, banda, quota, SSID.
- **Tokens em texto plano no DB**: aceito como tradeoff (curta validade, baixo blast radius). Recomenda-se cifrar o disco do servidor.
- **HMAC** assina o cookie de sessão admin (TTL 12h, `httpOnly`, `sameSite=lax`).
- **Rate limit**: 10 req/min por IP em `/api/portal/authorize` (quando não há proxy reverso informando o IP, a chave passa a ser o MAC do dispositivo) + teto global de 600 req/min.
- **Cabeçalhos de segurança** em todas as rotas: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **`COOKIE_SECURE=true`** em produção HTTPS.

### 15.1 Proteção do painel admin

O middleware [src/proxy.ts](src/proxy.ts) protege **tanto as páginas** (`/admin/*`) **quanto as APIs** (`/api/admin/*`):

- Sem cookie de sessão válido, páginas redirecionam para `/admin/login` e APIs respondem `401`.
- Allowlist explícita: `/admin/login`, `/api/admin/login`, `/admin/logout`, `/api/admin/logout`.
- Bypass por header `Authorization: Bearer ${CRON_SECRET}` é aceito **somente quando `CRON_SECRET` está definido com ≥ 16 caracteres**. Comparação em constant-time evita timing attack.
- `POST /api/admin/login` tem rate limit de **5 tentativas por minuto por IP** e usa mensagem genérica (`Credenciais inválidas`) para senha errada e rate-limit, evitando enumeração.

### 15.2 Chamadas internas autenticadas (cron / scripts)

Para disparar uma rota admin a partir de cron ou script local, use o `CRON_SECRET`:

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1/api/admin/<rota>
```

> Gere o segredo com `openssl rand -hex 32` e coloque em `.env` como `CRON_SECRET=...`. Caso o valor esteja vazio ou tenha menos de 16 caracteres, o bypass fica desabilitado e a única forma de chamar a API admin é com cookie de sessão.

### 15.3 Defesa CSRF (validação de Origin)

Requisições `POST`/`PUT`/`PATCH`/`DELETE` em `/api/admin/*` exigem que **Origin** ou **Referer** do request bata com o host servido. Falhar a checagem retorna `403 Origem inválida`. Bypass por Bearer (`CRON_SECRET`) ignora essa verificação para scripts internos.

### 15.4 Identificação do IP do cliente

O sistema lê o IP em ordem de confiança: `CF-Connecting-IP` (Cloudflare) → `X-Real-IP` (proxy reverso) → **último** hop de `X-Forwarded-For`. Em produção, **rode atrás de um proxy reverso confiável** (nginx, Cloudflare) que injete um desses headers — caso contrário o IP usado em rate-limit e logs é parcialmente spoofável.

### 15.5 TLS UniFi (certificado self-signed)

Controladoras UniFi em LAN normalmente apresentam certificado self-signed. Há duas opções para o cliente HTTP do portal:

1. **`UNIFI_INSECURE_TLS="true"`** (atual): desabilita a verificação do certificado. Aceitável apenas em segmento de rede confiável; o servidor fica vulnerável a MITM por quem comprometer a LAN entre o portal e o controlador.
2. **Confiar no CA da UniFi** (recomendado em produção): copie o certificado raiz da controladora para um arquivo PEM e aponte `NODE_EXTRA_CA_CERTS=/caminho/unifi-ca.pem` no `.env`. Deixe `UNIFI_INSECURE_TLS="false"`. O Node passa a aceitar **só** esse CA self-signed, e MITM volta a ser detectável.

### 15.6 Limites de entrada e validação de URL

- Nomes (`brandName`): até **120 caracteres**.
- Termos de uso: até **8000 caracteres**.
- Cor primária: hex `#RRGGBB`.
- `logoUrl`/`backgroundUrl`: aceitos apenas como **caminho de upload local** (`/api/uploads/<arquivo>`, ou o legado `/uploads/...`) ou URL absoluta `http(s)://`. Schemes `javascript:`, `data:`, `vbscript:` são rejeitados — defende contra XSS via `<img src>` injetado no painel.

---

## 16. Roadmap

Funcionalidades planejadas (não entregues nesta versão):

- 2FA (TOTP) para o painel admin.
- Bulk-create de tokens com export CSV.
- QR Code do token (deep-link `/portal?token=...`).
- Templates / presets de token.
- Self-service por SSO (Google/Microsoft).
- Webhooks de eventos de token (criado/usado/revogado/esgotado).
- Trade-off de SQLite → Postgres + Redis quando passar de single-instance.
