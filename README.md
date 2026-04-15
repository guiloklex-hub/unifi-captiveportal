# UniFi Captive Portal + BI

Portal Guest (External Portal Server) integrado com a controladora **Ubiquiti UniFi v10.1.89**, com painel administrativo e relatórios de Business Intelligence.

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS** + componentes shadcn/ui
- **Prisma ORM** + SQLite
- **Recharts** para gráficos BI
- **undici** para chamadas HTTPS à controladora (suporte a TLS self-signed)
- **PM2** para gerenciamento de processo em produção

---

## Pré-requisitos

- Ubuntu / Debian (ou derivado)
- Acesso `sudo`
- Controladora UniFi v10.1.89 acessível na rede

---

## 1. Instalação do ambiente

### 1.1 Instalar o NVM (Node Version Manager)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

Feche e reabra o terminal (ou carregue o nvm na sessão atual):

```bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
```

Verifique:

```bash
nvm --version
```

### 1.2 Instalar o Node.js

```bash
nvm install 24
nvm use 24
nvm alias default 24
```

Verifique:

```bash
node --version   # v24.x.x
npm --version    # 11.x.x
```

### 1.3 Permitir que o Node escute na porta 80 sem root

Portas abaixo de 1024 exigem privilégio no Linux. Em vez de rodar como root, conceda a capability diretamente ao binário do Node:

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

> Repita este comando sempre que atualizar a versão do Node via nvm.

### 1.4 Instalar o PM2 globalmente

```bash
npm install -g pm2
```

Verifique:

```bash
pm2 --version
```

---

## 2. Clonar e configurar o projeto

```bash
git clone <URL_DO_REPOSITORIO>
cd unifi-captive-portal
```

### 2.1 Criar o arquivo de variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com as suas configurações:

```bash
nano .env   # ou use o editor de sua preferência
```

Consulte a seção **Variáveis de ambiente** abaixo para detalhes de cada campo.

### 2.2 Instalar as dependências

```bash
npm install
```

### 2.3 Criar o banco de dados

```bash
npx prisma migrate deploy
```

> Em desenvolvimento, use `npx prisma migrate dev --name init` para criar e aplicar migrações interativamente.

---

## 3. Build e execução com PM2

### 3.1 Gerar o build de produção

```bash
npm run build
```

### 3.2 Iniciar com PM2

```bash
pm2 start ecosystem.config.js
```

Verifique se subiu corretamente:

```bash
pm2 status
pm2 logs unifi-portal --lines 20
```

O log deve exibir:

```
✓ Starting...
✓ Ready in Xms
```

### 3.3 Configurar inicialização automática no boot

```bash
pm2 startup
# Execute o comando que aparecer na tela (começa com "sudo env PATH=...")

pm2 save
```

### 3.4 Comandos PM2 do dia a dia

```bash
pm2 status                     # estado dos processos
pm2 logs unifi-portal          # logs em tempo real
pm2 restart unifi-portal       # reiniciar (ex: após alterar .env)
pm2 reload unifi-portal        # reload zero-downtime
pm2 stop unifi-portal          # parar
pm2 delete unifi-portal        # remover da lista do PM2
```

---

## 4. Variáveis de ambiente

Todas as variáveis ficam no arquivo `.env` na raiz do projeto.

| Variável | Obrigatório | Descrição | Exemplo |
|---|---|---|---|
| `DATABASE_URL` | Sim | Caminho do banco SQLite | `file:./prisma/dev.db` |
| `UNIFI_URL` | Sim | URL completa da controladora | `https://192.168.1.1:8443` |
| `UNIFI_USERNAME` | Sim | Usuário admin local da UniFi | `portal-api` |
| `UNIFI_PASSWORD` | Sim | Senha do usuário UniFi | `SenhaForte123` |
| `UNIFI_SITE` | Não | Nome do site UniFi | `default` |
| `UNIFI_INSECURE_TLS` | Não | `true` para aceitar certificado self-signed | `true` |
| `GUEST_DURATION_MIN` | Não | Duração da sessão em minutos (padrão: 480 = 8h) | `480` |
| `GUEST_DOWN_KBPS` | Não | Limite de download do guest em Kbps | `5120` |
| `GUEST_UP_KBPS` | Não | Limite de upload do guest em Kbps | `2048` |
| `PORTAL_SUCCESS_URL` | Não | URL para redirecionar após autorização | `https://empresa.com.br` |
| `ADMIN_PASSWORD` | Sim | Senha de acesso ao painel admin | `SenhaForte@2026` |
| `ADMIN_SECRET` | Sim | Segredo HMAC para assinar o cookie de sessão | *(veja abaixo)* |
| `COOKIE_SECURE` | Não | `true` somente se o app rodar com HTTPS | `false` |

**Gerar o `ADMIN_SECRET`:**

```bash
openssl rand -hex 32
```

Cole o resultado no `.env`:

```
ADMIN_SECRET="cole_aqui_o_valor_gerado"
```

> `ADMIN_SECRET` deve ter no mínimo 16 caracteres. Com menos, o sistema recusará iniciar.

---

## 5. Configurando a controladora UniFi

### 5.1 Criar usuário dedicado para a API

1. Acesse o painel da controladora UniFi.
2. Vá em **Settings → Admins → Add New Admin**.
3. Marque **Restrict to local access** e defina permissão **Site Admin**.
4. Anote as credenciais e insira em `UNIFI_USERNAME` / `UNIFI_PASSWORD` no `.env`.

### 5.2 Configurar o External Portal Server

1. Vá em **Settings → Profiles → Guest Hotspot** (ou **Hotspot** no menu lateral dependendo da versão).
2. Em **Authentication Methods → One Way Methods**, marque **External Portal Server** e clique em **Edit**.
3. No campo **External Portal**, informe o IP do servidor onde esta aplicação está rodando:
   ```
   172.24.16.103
   ```
   > A controladora vai redirecionar o cliente para `http://172.24.16.103/guest/s/default/?id=<MAC>&...`

4. Clique em **Save**.

### 5.3 Configurar a rede Guest

1. Vá em **Settings → Networks** e selecione ou crie a rede Wi-Fi Guest.
2. Certifique-se de que o perfil **Guest Hotspot** configurado acima está associado à rede.

### 5.4 Liberar acesso pré-autenticação

Em **Pre-Authorization Access**, adicione o IP e porta do servidor desta aplicação (`172.24.16.103:80`) para que o browser do cliente consiga carregar o portal antes de estar autenticado.

### 5.5 Fluxo completo após configuração

```
1. Cliente conecta na SSID Guest
2. Tenta acessar qualquer site
3. UniFi redireciona para:
   http://172.24.16.103/guest/s/default/?id=<MAC>&ap=<APMAC>&ssid=<SSID>&url=<originalUrl>
4. Aplicação redireciona internamente para /portal
5. Cliente preenche o formulário (Nome, E-mail, Telefone, CPF)
6. Backend valida, salva no SQLite e chama authorize-guest na UniFi
7. Cliente é redirecionado para PORTAL_SUCCESS_URL ou o site original
```

---

## 6. Acessando o sistema

| Interface | URL |
|---|---|
| Portal Guest | `http://IP_DO_SERVIDOR/portal` |
| Painel Admin | `http://IP_DO_SERVIDOR/admin` |

A senha do painel admin é a definida em `ADMIN_PASSWORD`.

---

## 7. Estrutura do projeto

```
unifi-captive-portal/
├── prisma/
│   ├── schema.prisma            # Modelo do banco de dados
│   └── migrations/              # Histórico de migrações
├── src/
│   ├── app/
│   │   ├── guest/s/[site]/      # Captura o redirect da UniFi
│   │   ├── portal/              # Formulário do captive portal
│   │   ├── admin/               # Painel administrativo
│   │   └── api/                 # Route handlers (backend)
│   │       ├── portal/authorize/
│   │       └── admin/{login,logout,logs,guests}
│   ├── components/
│   │   ├── portal/PortalForm.tsx
│   │   └── admin/{LogsTable,StatCard,RevokeButton,charts/}
│   ├── lib/
│   │   ├── unifi.ts             # Cliente HTTP UniFi (login, authorize, stat)
│   │   ├── validators.ts        # Validação CPF + telefone BR (zod)
│   │   ├── masks.ts             # Máscaras de input
│   │   ├── auth.ts              # Sessão admin via HMAC (Web Crypto API)
│   │   ├── csv.ts               # Exportação CSV
│   │   ├── prisma.ts            # Singleton do Prisma Client
│   │   └── utils.ts
│   └── middleware.ts            # Proteção das rotas /admin/*
├── ecosystem.config.js          # Configuração do PM2
├── .env.example                 # Modelo de variáveis de ambiente
└── README.md
```

---

## 8. Endpoints da API UniFi utilizados

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/login` | POST | Autentica e obtém cookie de sessão + CSRF token |
| `/api/s/{site}/cmd/stamgr` | POST | `authorize-guest`: libera MAC com duração e limites de banda |
| `/api/s/{site}/cmd/stamgr` | POST | `unauthorize-guest`: revoga acesso de um MAC |
| `/api/s/{site}/stat/guest` | GET | Lista sessões ativas com bytes TX/RX |

O cookie de sessão é cacheado em memória por ~55 minutos. Em caso de `401`, a aplicação faz relogin automaticamente.

---

## 9. Banco de dados

O SQLite é criado automaticamente em `prisma/dev.db` na primeira migração.

**Visualizar dados pelo Prisma Studio:**

```bash
npx prisma studio
```

Acesse `http://localhost:5555` para navegar e editar registros.

---

## 10. Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| Portal retorna **404** ao conectar no Wi-Fi | URL do portal sem o path correto | Coloque apenas o IP/host no campo External Portal da UniFi (sem `/portal`) |
| **Não consegue logar** no painel admin | Cookie com flag `Secure` em HTTP | Certifique-se de que `COOKIE_SECURE="false"` no `.env` |
| `Failed to start server` no PM2 | Node sem permissão para porta 80 | Rode `sudo setcap 'cap_net_bind_service=+ep' $(which node)` |
| Erro `UNIFI_URL não configurada` | `.env` não carregado | Confirme que o arquivo `.env` existe na raiz do projeto |
| `ADMIN_SECRET ausente` ao iniciar | Variável não definida | Gere com `openssl rand -hex 32` e adicione ao `.env` |
| **502** ao autorizar guest | Credenciais UniFi inválidas ou controladora inacessível | Verifique `UNIFI_URL`, `UNIFI_USERNAME`, `UNIFI_PASSWORD` e conectividade de rede |

---

## 11. LGPD

O formulário inclui checkbox de consentimento obrigatório. Antes de entrar em produção:

- Vincule sua **Política de Privacidade** ao texto do checkbox.
- Defina uma **política de retenção** de dados (os dados pessoais são armazenados em texto plano no SQLite).
- Considere criptografar campos sensíveis (CPF, telefone) em ambientes de alta criticidade.
