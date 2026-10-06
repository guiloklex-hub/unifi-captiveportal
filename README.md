# UniFi Captive Portal + BI

Portal para convidados (**External Portal Server**) da **Ubiquiti UniFi**, com painel administrativo, BI, tokens/vouchers, LGPD e integrações. Código aberto, em português, com suporte a PT/EN/ES no portal.

## Visão geral

| Área | Recursos |
|---|---|
| **Conexão UniFi** | **API Key** (API oficial, Network 9+) ou usuário/senha, com **fallback automático**; UniFi OS **e** Network Application clássica (5.x → 10.x); multi-site; tela de diagnóstico ("Testar conexão") |
| **Portal** | Formulário configurável (ou **acesso rápido** só com termos), estrangeiros sem CPF, **convidado recorrente** (1 clique), **código de verificação** por e-mail/SMS, **login Google/Microsoft**, tokens/vouchers com QR, marca por site, PT/EN/ES |
| **Painel** | Dashboard/BI, logs + CSV, sessões ao vivo (desconectar, **estender**, **bloquear**), **vouchers impressos**, bloqueios/liberações, liberar TVs/impressoras, **usuários com papéis + 2FA**, **auditoria** |
| **LGPD** | Versão dos termos aceita por cadastro, consentimento de marketing separado, exportar/anonimizar dados do titular, retenção em dois níveis (Marco Civil: 1 ano) |
| **Integrações** | Webhooks assinados, **API pública** com chaves e escopos, relatório por e-mail |
| **Operação** | Docker, PM2, backup, health check, CI com testes unitários + E2E |

**Compatibilidade**: veja a seção **[6.1](#61-formas-de-conexão-e-compatibilidade)**. Resumo: consoles UniFi OS e UniFi OS Server (Network 9+) → API Key; Network Application clássica (porta 8443) → usuário/senha; o modo `auto` escolhe sozinho.

**Documentação complementar**: [CHANGELOG](CHANGELOG.md) · [Integrações e API](docs/integracoes.md) · [Proxy reverso nginx/HTTPS](docs/nginx.md)

### Início rápido (Docker)

```bash
git clone https://github.com/guiloklex-hub/unifi-captiveportal && cd unifi-captiveportal
cp .env.example .env            # edite UNIFI_URL, UNIFI_API_KEY ou UNIFI_USERNAME/PASSWORD, ADMIN_PASSWORD
sed -i "s|^ADMIN_SECRET=.*|ADMIN_SECRET=\"$(openssl rand -hex 32)\"|" .env   # obrigatório
docker compose up -d --build    # portal em http://IP_DO_SERVIDOR/ (porta 80)
```

Depois: acesse `/admin`, entre com `ADMIN_PASSWORD`, crie seu usuário em **Usuários** e configure a controladora em **Conexão UniFi** (seção 6). Sem Docker, siga as seções **1–3** (Node + PM2).

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

## 0. Instalação com Docker (recomendado)

```bash
cp .env.example .env              # configure (seção 5)
docker compose up -d --build      # build + start; migrações rodam sozinhas no boot
docker compose logs -f portal     # acompanhar
```

- Banco SQLite e imagens enviadas ficam no volume `portal-data` (`/data` no container).
- A porta 80 do host vai para o container (a UniFi redireciona para `http://IP/guest/s/<site>/`).
- Health check embutido (`/api/healthz`); `restart: unless-stopped`.
- Atualizar: `git pull && docker compose up -d --build`.
- Backup: `docker compose exec portal sh -c 'cp /data/portal.db /data/backup-$(date +%F).db'` ou copie o volume.
- Atrás de proxy corporativo com CA própria: `docker build --secret id=ca,src=ca.pem .`
- **Mudou o `.env`?** Rode `docker compose up -d` (recria o container). `docker compose restart` **não** relê o `.env`.

**Antes de subir, o container valida o `.env`** (`scripts/docker-preflight.mts`) e mostra o resultado em `docker compose logs portal`:

| Situação | O que acontece |
|---|---|
| `ADMIN_SECRET` vazio, de exemplo ou com menos de 32 caracteres | O container **não sobe** e o log diz como gerar (`openssl rand -hex 32`). |
| Valores entre aspas com `docker run --env-file` (que, diferente do Compose, não remove aspas) | As aspas são removidas, com aviso. |
| `DATABASE_URL` relativo (o do `.env.example`) | Usa `file:/data/portal.db` (volume), com aviso. |

Senha com `$`: no Compose, `$abc` é interpretado como variável — use aspas simples (`ADMIN_PASSWORD='Senha$abc'`).

**Login do painel recusado?** O primeiro acesso é com o campo **Usuário** vazio (ou `admin`) e a senha de `ADMIN_PASSWORD`; depois que existir um usuário cadastrado, `ADMIN_PASSWORD` deixa de valer (salvo `ADMIN_BREAK_GLASS="true"`). Cinco tentativas erradas em 1 minuto bloqueiam o login por 1 minuto, com a mesma mensagem de credenciais inválidas.

**Convidado conecta mas fica "sem internet" e o portal não abre** (controladora UniFi):
- A rede de convidados precisa de um DNS **alcançável antes do login** (ex.: `1.1.1.1`); um DNS interno em `10.x`/`192.168.x` costuma estar bloqueado pela política de convidados.
- Em **Pre-Authorization Access**, libere o **IP da controladora** quando ela não for o próprio gateway (ex.: USG + Cloud Key): o convidado passa primeiro pela controladora antes de ser enviado ao portal externo. O IP configurado como *External Portal Server* costuma ser liberado automaticamente pela UniFi.

**Controladora em `172.17.x.x`–`172.31.x.x` (ou `192.168.x.x`) não responde do container** ("fetch failed", "EHOSTUNREACH" ou "tempo de conexão esgotado" em **Conexão UniFi**, mesmo funcionando pelo navegador/Postman do seu computador):
o Docker cria suas redes internas nessas faixas (`docker0` = `172.17.0.0/16`, a do Compose costuma ser `172.18.0.0/16`). Se a controladora estiver numa delas, o servidor entrega os pacotes à bridge do Docker e eles nunca chegam à LAN. Confirme no servidor:

```bash
ip route get 172.18.1.2          # IP da controladora; se citar docker0 ou br-…, há conflito
docker network inspect $(docker network ls -q -f name=_default) | grep Subnet
```

Corrija fixando a rede do Compose numa faixa que não exista na sua LAN — descomente o bloco `networks:` no final do `docker-compose.yml` e recrie: `docker compose down && docker compose up -d`. Se o conflito for com `docker0` (`172.17.0.0/16`) ou com outros projetos, ajuste também `/etc/docker/daemon.json` (`"bip"` e `"default-address-pools"`) e reinicie o Docker. A tela **Conexão UniFi** avisa quando detecta esse conflito.

As seções 1–3 abaixo descrevem a instalação tradicional com Node + PM2.

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

### 4.1.1 Atualizando de versões anteriores a esta revisão

A revisão de 2026 (ver [CHANGELOG](CHANGELOG.md)) traz migrações de banco e algumas mudanças de comportamento. Passo a passo:

1. **Backup** do banco (`scripts/backup.sh`) antes de tudo.
2. Node **≥ 22.19** (recomendado 24): `node -v`.
3. `git pull && npm ci && npx prisma migrate deploy && npm run build && pm2 reload unifi-portal`.
4. **Login do painel**: entre com usuário vazio e a senha `ADMIN_PASSWORD` de sempre, vá em **Usuários** e crie seu administrador (a senha do `.env` deixa de valer depois do primeiro usuário). Sessões abertas antes da atualização precisarão entrar de novo.
5. **Conexão UniFi**: nada muda se o `.env` já funcionava. Para usar **API Key**, crie a chave na UniFi (seção 6.1) e informe em **Conexão UniFi** → Testar → Salvar.
6. **Retenção**: o padrão passou de 180 para **365 dias** (Marco Civil). Se quiser manter 180, defina `GUEST_RETENTION_DAYS=180`.
7. Se o portal roda direto na porta 80 sem proxy reverso, considere o **nginx** (seção 4.7) para HTTPS no painel, IP real do cliente e login social.

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

### 4.7 Proxy reverso (nginx) e HTTPS

Recomendado em produção: HTTPS no painel, IP real do cliente (rate limit, logs, busca de MAC por IP) e obrigatório para **login social**. Exemplo completo em **[docs/nginx.md](docs/nginx.md)**. Com HTTPS, defina `COOKIE_SECURE=true` e `PUBLIC_PORTAL_URL=https://…`.

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
| `ADMIN_PASSWORD` | Sim* | Senha de **primeiro acesso** ao painel (antes de existir usuários) | `SenhaForte@2026` |
| `ADMIN_BREAK_GLASS` | Não | `true` reabre o login por `ADMIN_PASSWORD` mesmo com usuários cadastrados (emergência — ex.: único admin perdeu o 2FA). Deixe desligado | `false` |
| `ADMIN_SECRET` | Sim | Segredo HMAC para sessão (mín. **32 chars** — app não inicia abaixo disso) | *(gerar)* |
| `CRON_SECRET` | Não | Bearer token do cron para `POST /api/admin/cleanup` e `POST /api/admin/reports/send` (só essas rotas). Gere com `openssl rand -hex 32`; vazio ou < 16 chars desabilita. | *(string hex 32+ chars)* |
| `ADMIN_ALLOWED_NETWORKS` | Recomendado | IPs/CIDRs de onde o painel (`/admin`, `/api/admin`) pode ser acessado; fora deles, 404. Loopback sempre liberado. Vazio = sem restrição. Ver **15.6** | `10.35.10.0/24,10.35.48.0/24` |
| `TRUST_PROXY` | Não | Em quem confiar para `X-Real-IP`/`X-Forwarded-For`. Vazio = só loopback (nginx no mesmo host); `true` = qualquer; `false` = nunca; ou lista de IPs/CIDRs. Ver **15.4** | `172.17.0.1` |
| `LOG_LEVEL` | Não | Nível de log (`debug`, `info`, `warn`, `error`, `silent`). Padrão `info` em produção | `info` |
| `GUEST_RETENTION_DAYS` | Não | Retenção dos `GuestRegistration` em dias (mínimo 7, default 365 — Marco Civil) | `365` |
| `PII_RETENTION_DAYS` | Não | Anonimiza nome/e-mail/telefone/documentos após N dias, mantendo o registro de conexão até `GUEST_RETENTION_DAYS`. Vazio = desligado | `90` |
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

### 8.2 Verificação por código e login social (opcionais)

**Código de verificação** (Customização → Verificação e login social):
- **Por e-mail** ou **por SMS**: ao enviar o formulário, o convidado recebe um código de 6 dígitos (válido por 10 min, até 5 tentativas, reenvio após 45 s por dispositivo **e** por destinatário, no máximo 5 códigos por telefone/e-mail a cada 24 h — evita disparo em massa contra uma vítima). Só depois de digitar o código o acesso é liberado — a autorização direta passa a ser recusada.
- **E-mail**: como o convidado ainda não tem internet, o portal libera um **acesso provisório** (padrão 10 min, banda reduzida, no máximo 2 por dispositivo/dia) para ele abrir a caixa de entrada. Configure SMTP no `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`).
- **SMS**: `SMS_PROVIDER=twilio` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) ou `SMS_PROVIDER=webhook` (`SMS_WEBHOOK_URL` recebe `POST {"to":"+55…","message":"…"}`, com `SMS_WEBHOOK_TOKEN` opcional como Bearer) — o webhook permite usar qualquer gateway (Zenvia, Infobip, AWS SNS, WhatsApp via n8n/Make…).
- O código nunca é gravado (só um HMAC dele) e vale uma única vez.

**Login social** (Google e/ou Microsoft):
- Nome e e-mail chegam **verificados pelo provedor** (dispensa o código); os demais campos obrigatórios (CPF, celular) continuam sendo pedidos.
- Requisitos: `PUBLIC_PORTAL_URL` com **HTTPS** (os provedores não aceitam redirect HTTP), credenciais OAuth no `.env` (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`/`MICROSOFT_TENANT`) e o **URI de redirecionamento** `https://<seu-portal>/api/portal/oauth/callback` cadastrado no provedor (o painel mostra o valor exato).
- Os domínios de login precisam estar no **walled garden** da UniFi (ponto de partida — confirme com o provedor, a lista muda):
  - Google: `accounts.google.com`, `ssl.gstatic.com`, `www.gstatic.com`, `fonts.gstatic.com`, `apis.google.com`, `accounts.youtube.com`
  - Microsoft: `login.microsoftonline.com`, `login.live.com`, `login.microsoft.com`, `aadcdn.msftauth.net`, `aadcdn.msauth.net`, `logincdn.msauth.net`
- Fluxo OAuth 2.0 / OpenID Connect com **PKCE**, `state` e `nonce`; o ticket devolvido ao portal é de uso único e amarrado ao MAC.

### 8.3 Vouchers impressos

Em **Tokens → Novo token**, informe **Quantidade** (até 500) para criar um lote de tokens idênticos e clique em **Imprimir vouchers**: a folha A4 traz 8 cartões por página com QR code, código, tempo de acesso, validade e (opcional) o nome da rede Wi‑Fi. Lotes antigos podem ser reimpressos pelo botão **Imprimir lote** na lista.

> **Por que não os vouchers nativos da UniFi?** Os vouchers do Hotspot da UniFi são validados pelo portal *interno* da controladora. Com portal externo (este projeto) não há API para validar/consumir um voucher UniFi — por isso o portal usa o próprio sistema de tokens, que tem os mesmos recursos (tempo, banda, cota, usos, validade) e ainda gera QR code.

### 8.4 Portal aberto sem MAC (QR code)

Quando o celular abre o link do QR code direto na câmera, a URL não traz o `?id=<MAC>` que a controladora injeta. O portal então procura o MAC na controladora **pelo IP do cliente** e segue normalmente. Requer proxy reverso que informe o IP real (`X-Real-IP` / `X-Forwarded-For`); desative com `PORTAL_MAC_LOOKUP=false`.

---

### 8.5 Integrações (webhooks, API pública e relatórios)

Em **Painel → Integrações** (admin):
- **Webhooks** assinados (HMAC-SHA256) para `guest.authorized`, `guest.revoked` e `rule.created` — conecte n8n/Make/Zapier e, por eles, RD Station, HubSpot, Mailchimp, planilhas. Dados pessoais só vão se marcado.
- **API pública v1** com chaves e escopos (`read`, `read:pii`, `write`): métricas, sessões, cadastros, criação de vouchers (ex.: PMS no check-in) e liberação de dispositivos.
- **Relatório por e-mail** diário ou semanal (conexões, visitantes, formas de acesso, sites).

Guia completo, formato dos eventos, verificação de assinatura e referência da API: **[docs/integracoes.md](docs/integracoes.md)**.

---

## 9. Acessando o sistema

| Interface | URL |
|---|---|
| Portal Guest | `http://IP_DO_SERVIDOR/portal` |
| Painel Admin | `http://IP_DO_SERVIDOR/admin` |

No primeiro acesso, entre com `ADMIN_PASSWORD` do `.env` e crie os usuários do painel em **Usuários** (seção 15.1).

---

## 10. Estrutura do projeto

```
unifi-captive-portal/
├── prisma/                        # schema.prisma + migrações
├── docs/                          # integracoes.md, nginx.md
├── scripts/                       # backup.sh, mock-unifi.ts, docker-entrypoint.sh
├── tests/
│   ├── unit/                      # Vitest
│   ├── e2e/                       # Playwright (portal + painel contra UniFi simulada)
│   └── helpers/mockUnifi.ts       # Controladora UniFi simulada (OS/Classic/API oficial)
├── src/
│   ├── proxy.ts                   # Autenticação, RBAC e CSRF do painel
│   ├── app/
│   │   ├── guest/s/[site]/        # Captura o redirect da UniFi
│   │   ├── portal/                # Formulário, recorrente, código, social, sucesso
│   │   ├── admin/(panel)/         # Dashboard, logs, sessões, tokens, bloqueios, customização,
│   │   │                          # conexão UniFi, integrações, usuários, privacidade, auditoria, conta
│   │   ├── admin/print/vouchers/  # Folha de vouchers para imprimir
│   │   └── api/
│   │       ├── portal/            # authorize, reconnect, otp/*, oauth/*, session
│   │       ├── admin/             # APIs do painel (protegidas pelo proxy)
│   │       └── v1/                # API pública (chaves ucp_…)
│   ├── components/                # portal/, admin/, ui/ (shadcn)
│   └── lib/
│       ├── unifi/                 # Cliente UniFi: estratégias, API oficial, legada, transporte
│       ├── portal/                # grantAccess (pipeline único), OTP, OAuth, regras, recorrente
│       ├── admin/                 # senhas, TOTP, sessão, RBAC, auditoria, usuários
│       ├── integrations/          # webhooks, chaves de API, métricas, relatórios
│       ├── messaging/             # e-mail (SMTP) e SMS
│       ├── privacy.ts             # LGPD: termos, anonimização, titular
│       ├── settings.ts            # Configurações + marca por site + perfil padrão
│       └── i18n/dictionaries.ts   # PT/EN/ES
├── Dockerfile · docker-compose.yml · ecosystem.config.js (PM2)
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
| `/api/portal/otp/start` | POST | Valida o formulário e envia o código (e-mail/SMS) |
| `/api/portal/otp/verify` | POST | Confere o código e libera o acesso |
| `/api/portal/oauth/{google\|microsoft}/start` | GET | Inicia o login social |
| `/api/portal/oauth/callback` | GET | Retorno do provedor (redirect URI) |

### Administrativos

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/admin/login` | POST | Login (usuário + senha; responde `mfaRequired` quando há 2FA) |
| `/api/admin/login/mfa` | POST | Segundo fator (código TOTP) |
| `/api/admin/logout` | POST | Logout |
| `/api/admin/users` e `/api/admin/users/[id]` | GET/POST/PATCH/DELETE | Usuários do painel (admin) |
| `/api/admin/account`, `/account/password`, `/account/totp` | GET/POST/PUT/DELETE | Conta logada: senha e 2FA |
| `/api/admin/audit` | GET | Trilha de auditoria (JSON ou `?format=csv`) |
| `/api/admin/privacy/subject` (+ `/export`, `/anonymize`) | GET/POST | LGPD: localizar, exportar (JSON) e anonimizar dados de um titular |
| `/api/admin/privacy/terms` | GET | Versões dos termos aceitos e configuração de retenção |
| `/api/admin/integrations/webhooks` (+ `/[id]`, `/[id]/test`) | GET/POST/PATCH/DELETE | Webhooks de saída |
| `/api/admin/integrations/api-keys` (+ `/[id]`) | GET/POST/DELETE | Chaves da API pública |
| `/api/admin/reports/send` | POST | Relatório por e-mail (cron diário; `?force=1` envia já) |

### API pública (`Authorization: Bearer ucp_…`)

| Endpoint | Método | Escopo |
|---|---|---|
| `/api/v1/metrics` | GET | `read` |
| `/api/v1/sessions` | GET | `read` |
| `/api/v1/registrations` | GET | `read` (`read:pii` para dados pessoais) |
| `/api/v1/vouchers` | POST | `write` |
| `/api/v1/devices/authorize` | POST | `write` |
| `/api/admin/access-rules` e `/[id]` | GET/POST/DELETE | Bloqueios e liberações |
| `/api/admin/guests/authorize` | POST | Liberar dispositivo agora (sem portal) |
| `/api/admin/guests/extend` | POST | Estender sessão de um guest |
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
| `/api/healthz` | GET | Status agregado. 200 = ok/degraded; 503 = DB ou disco caído. Detalhes (UniFi, DB, disco, versão) só para o próprio servidor ou `ADMIN_ALLOWED_NETWORKS`. |

---

## 13. Banco de dados

SQLite (WAL) em `prisma/dev.db` (ou `/data/portal.db` no Docker). Principais modelos:

| Modelo | Conteúdo |
|---|---|
| `GuestRegistration` | Cada autorização: dados do convidado (conforme o formulário), MAC, IP, site, limites, uso medido, forma de acesso, versão dos termos, consentimento de marketing, anonimização |
| `AccessToken` | Tokens/vouchers (limites, usos, validade, lote) |
| `SystemSettings` / `SiteBranding` | Configurações globais e marca por site |
| `UniFiConnection` | Conexão com a controladora salva pelo painel (segredos cifrados) |
| `AdminUser` / `AuditLog` | Usuários do painel e trilha de auditoria |
| `AccessRule` | Bloqueios e liberações |
| `OtpChallenge` / `OAuthLogin` | Códigos de verificação e logins sociais em andamento (limpos em 24 h) |
| `TermsVersion` | Texto de cada versão dos termos aceita |
| `Webhook` / `ApiKey` | Integrações |

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
| "Nenhuma forma de conexão funcionou" em Conexão UniFi | URL/porta errada, certificado, credencial ou MFA na conta | Use **Testar conexão**: cada estratégia mostra o erro. Classic → `https://IP:8443` + usuário local sem MFA; UniFi OS → `https://IP` + API Key |
| "fetch failed — EHOSTUNREACH/tempo de conexão esgotado" em Conexão UniFi, mas a controladora responde do seu computador | No Docker: IP da controladora dentro da rede interna do Docker (`172.17`–`172.31.x.x`); fora dele: firewall/rota do servidor | Seção **0** ("Controladora … não responde do container"); teste do próprio servidor com `curl -k https://IP:8443/status` |
| Convidado vê "Serviço temporariamente indisponível" | Controladora inalcançável ou credencial inválida | `/api/healthz` e **Conexão UniFi → Testar conexão**; veja os logs |
| Esqueci a senha / perdi o 2FA do único admin | — | Defina `ADMIN_BREAK_GLASS=true`, entre com `ADMIN_PASSWORD`, redefina em **Usuários** e volte para `false` |
| Botões de login social não aparecem | Falta HTTPS em `PUBLIC_PORTAL_URL` ou credenciais OAuth | Seção **8.2** |
| Código por e-mail/SMS não chega | SMTP/SMS não configurado | Painel mostra aviso em Customização; veja **8.2** e os logs |
| QR code do token abre "Acesso indisponível" | Sem proxy reverso informando o IP do cliente | Configure o nginx (**4.7**) — o portal então descobre o MAC pelo IP |
| `Could not find a production build in .next` | `npm run build` não rodou nesse host após o `git pull` | Rode `npm run build` antes de `pm2 reload unifi-portal` (seção **4.1**) |

---

## 15. LGPD e segurança

### 15.0 Privacidade (LGPD) — menu **Privacidade (LGPD)**, só admin

- **Minimização**: formulário configurável (só pedir o necessário) — seção **8.1**.
- **Consentimento com prova**: cada cadastro guarda o **hash SHA-256 da versão dos termos** aceita; o texto de cada versão fica arquivado (tabela `TermsVersion`) e pode ser consultado no painel. Se os termos mudarem, o convidado recorrente precisa aceitar de novo.
- **Consentimento de marketing separado** (opcional, desmarcado por padrão, texto editável em Customização) — gravado por cadastro e exportado no CSV.
- **Direitos do titular** (art. 18): localizar os dados por CPF, e-mail, documento ou telefone; **exportar** tudo em JSON (acesso/portabilidade, com as versões dos termos aceitos) e **anonimizar** (eliminação). Ambas as ações vão para a auditoria.
- **Retenção em dois níveis**: `PII_RETENTION_DAYS` anonimiza os dados pessoais antes; `GUEST_RETENTION_DAYS` (padrão 365 — Marco Civil, art. 13) apaga o registro de conexão (MAC, IP, horários). A anonimização mantém o registro de conexão.
- **Mínimo necessário para quem só consulta**: o papel "Somente leitura" recebe CPF, e-mail, telefone e documento **mascarados** (tela e CSV).
- A tela de sucesso lê um endpoint que **não devolve** CPF, e-mail ou telefone.

> **Criptografia de CPF no banco**: não foi adotada criptografia por coluna — ela impediria as buscas/índices usados no bloqueio de CPF, na busca de logs e no BI, e a perda da chave tornaria os dados irrecuperáveis. A proteção adotada é: anonimização por prazo, mascaramento por papel, auditoria e controle de acesso. **Recomendado**: disco cifrado (LUKS/BitLocker) e backups cifrados. Segredos (senha/API Key da UniFi, 2FA) **são** cifrados com AES-256-GCM.
>
> Este projeto oferece ferramentas; a adequação à LGPD (base legal, aviso de privacidade, encarregado/DPO) é responsabilidade do controlador — revise os termos de uso com seu jurídico.

### 15.0.1 Segurança geral

- **Tokens em texto plano no DB**: aceito como tradeoff (curta validade, baixo blast radius).
- **HMAC** assina o cookie de sessão admin (TTL 12h, `httpOnly`, `sameSite=lax`).
- **Rate limit**: 10 req/min por IP em `/api/portal/authorize` (quando não há proxy reverso informando o IP, a chave passa a ser o MAC do dispositivo) + teto global de 600 req/min.
- **Cabeçalhos de segurança** em todas as rotas: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **`COOKIE_SECURE=true`** em produção HTTPS.

### 15.1 Proteção do painel admin

**Usuários, papéis e 2FA** (menu **Usuários** e **Minha conta**):

| Papel | Pode |
|---|---|
| **Administrador** | Tudo, inclusive Usuários, Auditoria, Conexão UniFi e Customização |
| **Operador** | Operação do dia a dia: tokens/vouchers, sessões (desconectar, estender, bloquear), bloqueios e liberações, logs, reconciliação |
| **Somente leitura** | Consultar dashboard, logs, sessões e tokens (apenas `GET`) |

- **Primeiro acesso / atualização de versões antigas**: entre com usuário vazio (ou `admin`) e a senha `ADMIN_PASSWORD`, abra **Usuários** e crie o primeiro administrador. A partir daí o login por `ADMIN_PASSWORD` é desativado (a menos que `ADMIN_BREAK_GLASS=true`).
- Senhas com **scrypt** (mínimo 10 caracteres, letras e números); **bloqueio de 15 min após 5 tentativas** erradas.
- **2FA (TOTP)** opcional por usuário, compatível com Google/Microsoft Authenticator, Authy, 1Password. Um admin pode zerar o 2FA de outro usuário.
- Trocar senha, papel, desativar ou zerar 2FA **derruba as sessões abertas** daquele usuário.
- O middleware [src/proxy.ts](src/proxy.ts) valida a sessão no banco e aplica o **RBAC** a páginas (`/admin/*`) e APIs (`/api/admin/*`): sem sessão → login/`401`; sem permissão → `403`.
- `POST /api/admin/login` tem rate limit por IP+usuário e mensagem genérica (`Credenciais inválidas`); logout só por `POST`.

**Auditoria** (menu **Auditoria**, só admin): login (sucesso/falha), usuários, conta, Customização, marca por site, conexão UniFi, tokens (criar/revogar/estender/excluir), sessões (desconectar/estender/liberar CPF), bloqueios/liberações, uploads e limpeza — com usuário, data/hora, alvo, detalhes e IP. Exporta CSV.

**Bloqueios e liberações** (menu **Bloqueios e liberações**):
- **Bloquear** por MAC, CPF, e-mail ou documento (com motivo e validade opcional). O botão **Bloquear** na tela de Sessões bloqueia e desconecta o dispositivo na hora.
- **Liberar dispositivo** (por MAC): o aparelho conecta com um clique, sem formulário nem token — útil para equipe e parceiros.
- **Liberar agora (sem navegador)**: autoriza um MAC direto na UniFi por minutos/horas/dias — TVs, impressoras, consoles.
- **Estender sessão**: na tela de Sessões, adiciona tempo a um convidado conectado.

### 15.2 Chamadas internas autenticadas (cron / scripts)

Para as tarefas agendadas, use o `CRON_SECRET`. Ele é aceito **só** em `POST /api/admin/cleanup` e `POST /api/admin/reports/send`; as demais rotas do painel exigem sessão.

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1/api/admin/cleanup
```

> Gere o segredo com `openssl rand -hex 32` e coloque em `.env` como `CRON_SECRET=...`. Caso o valor esteja vazio ou tenha menos de 16 caracteres, o bypass fica desabilitado e a única forma de chamar a API admin é com cookie de sessão.

### 15.3 Defesa CSRF (validação de Origin)

Requisições `POST`/`PUT`/`PATCH`/`DELETE` em `/api/admin/*` exigem que **Origin** ou **Referer** do request bata com o host servido. Falhar a checagem retorna `403 Origem inválida`. Bypass por Bearer (`CRON_SECRET`) ignora essa verificação, mas **só** em `POST /api/admin/cleanup` e `POST /api/admin/reports/send` — o token não abre o restante do painel.

### 15.4 Identificação do IP do cliente

O IP do cliente alimenta rate limit, logs de conexão (Marco Civil), a busca do MAC por IP e `ADMIN_ALLOWED_NETWORKS`. Por isso ele **não** é lido de cabeçalhos enviados por qualquer um: `scripts/client-ip.cjs`, carregado antes do servidor (entrypoint do Docker e `NODE_OPTIONS` no `ecosystem.config.js`), descarta `X-Forwarded-For`, `X-Real-IP` e `CF-Connecting-IP` quando a conexão **não** vem de um proxy confiável e usa o endereço real do socket.

| Instalação | `TRUST_PROXY` |
|---|---|
| Docker exposto direto na porta 80 | vazio (padrão) |
| PM2 + nginx **no mesmo host** | vazio (loopback já é confiável) |
| nginx no host → container Docker | IP do gateway da rede Docker (ex.: `172.17.0.1`) |
| Atrás de Cloudflare/balanceador | IPs/CIDRs do proxy, ou `true` se só ele alcança o portal |

Atrás de um proxy confiável vale a ordem `CF-Connecting-IP` → `X-Real-IP` → último hop de `X-Forwarded-For`.

### 15.5 TLS UniFi (certificado self-signed)

Controladoras UniFi em LAN normalmente apresentam certificado self-signed. Há duas opções para o cliente HTTP do portal:

1. **`UNIFI_INSECURE_TLS="true"`** (atual): desabilita a verificação do certificado. Aceitável apenas em segmento de rede confiável; o servidor fica vulnerável a MITM por quem comprometer a LAN entre o portal e o controlador.
2. **Confiar no CA da UniFi** (recomendado em produção): copie o certificado raiz da controladora para um arquivo PEM e aponte `NODE_EXTRA_CA_CERTS=/caminho/unifi-ca.pem` no `.env`. Deixe `UNIFI_INSECURE_TLS="false"`. O Node passa a aceitar **só** esse CA self-signed, e MITM volta a ser detectável.

### 15.6 Painel fora da rede de convidados (`ADMIN_ALLOWED_NETWORKS`)

Com portal externo, a UniFi libera o IP do portal para convidados **ainda não autenticados** — e o painel está no mesmo IP e porta. Não há como bloquear só `/admin` na UniFi sem quebrar o portal. Defina as redes administrativas:

```env
ADMIN_ALLOWED_NETWORKS="10.35.10.0/24,10.35.48.0/24"
```

Fora delas, `/admin` e `/api/admin` respondem **404** (nem a tela de login aparece). Loopback é sempre permitido (cron local, túnel SSH). No Docker, quem abre `http://localhost` no próprio servidor chega com o IP do gateway da rede Docker (ex.: `172.17.0.1`) — inclua-o na lista se quiser usar o painel por ali, ou acesse pelo IP da LAN. O `/api/healthz` também só mostra detalhes (versão, disco, UniFi) para essas redes. Depende do IP real (15.4).

### 15.7 Limites de entrada e validação de URL

- Nomes (`brandName`): até **120 caracteres**.
- Termos de uso: até **8000 caracteres**.
- Cor primária: hex `#RRGGBB`.
- `logoUrl`/`backgroundUrl`: aceitos apenas como **caminho de upload local** (`/api/uploads/<arquivo>`, ou o legado `/uploads/...`) ou URL absoluta `http(s)://`. Schemes `javascript:`, `data:`, `vbscript:` são rejeitados — defende contra XSS via `<img src>` injetado no painel.

---

## 16. Roadmap

Entregue na revisão de 2026: API Key/fallback UniFi, formas de acesso (OTP, social, recorrente, acesso rápido), vouchers impressos, usuários/2FA/auditoria, bloqueios, LGPD, webhooks, API pública, relatórios, Docker e E2E — ver [CHANGELOG](CHANGELOG.md).

Próximos passos possíveis:

- Vários controladores UniFi em uma única instalação do portal (hoje: um por instância).
- SQLite → PostgreSQL + Redis para rodar em múltiplas instâncias.
- Criptografia opcional de CPF por coluna (com "blind index" para buscas exatas).
- Conectores nativos de CRM (hoje via webhooks + n8n/Make/Zapier).
- Wi‑Fi pago (PIX) e planos de acesso.
