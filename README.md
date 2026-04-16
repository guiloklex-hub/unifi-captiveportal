# UniFi Captive Portal + BI

Portal Guest (External Portal Server) integrado com a controladora **Ubiquiti UniFi v10.1.89**, com painel administrativo, relatórios de BI e **customização total de branding**.

---

### ✨ Atualizações Recentes (Abril 2026)

- **UX Mobile-First**: Otimização completa dos formulários para evitar zoom no iOS, touch targets maiores e layouts que respeitam áreas seguras (Notch/CNA).
- **Redirecionamento Dinâmico**: O sistema agora detecta automaticamente o Host (IP ou domínio) de acesso, evitando erros de redirecionamento para `localhost`.
- **Deduplicação de Sessões**: Melhoria na lógica de exibição de visitantes ativos e mapeamento de registros do banco de dados.

---

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS** + componentes shadcn/ui
- **Prisma ORM** + SQLite
- **Recharts** para gráficos BI
- **react-markdown** para termos de uso formatados
- **undici** para chamadas HTTPS à controladora (suporte a TLS self-signed)
- **PM2** para gerenciamento de processo em produção

---

## Pré-requisitos

- Ubuntu / Debian (ou derivado)
- Acesso `sudo`
- Controladora UniFi v10.1.89 acessível na rede

---

## 1. Instalação do ambiente

### 1.1 Preparação do Sistema Operacional (Debian Puro / Ubuntu)

Em um servidor recém-criado (Debian/Ubuntu puro), acesse como usuário `root` (ou usando `sudo`) e prepare os pacotes fundamentais que geralmente não vêm instalados:

```bash
apt update && apt upgrade -y
apt install -y sudo curl git build-essential libcap2-bin
```

*(Nota: o `libcap2-bin` nos dará a ferramenta para liberar a porta 80, o `git` clonará o projeto e o `curl` baixará o Node).*

### 1.2 Instalar o NVM (Node Version Manager)

O NVM facilita a instalação e a troca de versões do Node.js.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

Carregue as variáveis de ambiente do NVM na sessão atual do seu terminal:

```bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
```

Verifique se foi instalado com sucesso:

```bash
nvm --version
```

### 1.3 Instalar o Node.js (Versão 24.x)

```bash
nvm install 24
nvm use 24
nvm alias default 24
```

Cheque as versões do Node e do NPM instaladas:

```bash
node --version   # deve exibir v24.x.x
npm --version    # deve exibir 11.x.x ou superior
```

### 1.4 Permitir que o Node escute na porta 80 sem root

Portas abaixo de 1024 exigem privilégio no Linux. Em vez de rodar toda a aplicação como Administrador, é muito mais seguro conceder a permissão exclusiva para a porta HTTP ao Node, usando o pacote `libcap2-bin` que baixamos no primeiro passo:

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

> **Importante:** Repita este comando sempre que você atualizar a versão do Node no futuro.

### 1.5 Instalar o PM2 globalmente

O PM2 vai atuar como o "motor" que manterá a aplicação sempre ativa, permitindo inicialização automática e visualização de logs.

```bash
npm install -g pm2
```

Verifique a instalação:

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

## 4. Atualização e Manutenção

### 4.1 Como aplicar atualizações (git pull)

Caso você já tenha o sistema rodando e queira baixar as últimas melhorias sem perder seus dados ( registros no SQLite e uploads locais):

```bash
# 1. Acesse a pasta do projeto
cd unifi-captive-portal

# 2. Puxe as atualizações do GitHub
git pull origin main

# 3. Instale novas dependências (se houver)
npm install

# 4. Sincronize o banco de dados (IMPORTANTE)
npx prisma migrate deploy

# 5. Gere o novo build de produção
npm run build

# 6. Recarregue o PM2 (zero downtime)
pm2 reload unifi-portal
```

### 4.2 Instalação Limpa (Reset total)

Caso queira remover tudo e começar do zero (Atenção: isso apagará seus cadastros e imagens):

```bash
# 1. Pare o processo atual
pm2 delete unifi-portal

# 2. Remova a pasta e clone novamente
cd ..
rm -rf unifi-captive-portal
git clone <URL_DO_REPOSITORIO>
cd unifi-captive-portal

# 3. Siga o Guia de Instalação (seção 2 e 3)
```

---

## 5. Variáveis de ambiente

Todas as variáveis ficam no arquivo `.env` na raiz do projeto.

| Variável | Obrigatório | Descrição | Exemplo |
|---|---|---|---|
| `DATABASE_URL` | Sim | Caminho do banco SQLite | `file:./dev.db` |
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

## 6. Configurando a controladora UniFi

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
   IP_DO_SERVIDOR
   ```
   > A controladora vai redirecionar o cliente para `http://IP_DO_SERVIDOR/guest/s/default/?id=<MAC>&...`

4. Clique em **Save**.

### 5.3 Configurar a rede Guest

1. Vá em **Settings → Networks** e selecione ou crie a rede Wi-Fi Guest.
2. Certifique-se de que o perfil **Guest Hotspot** configurado acima está associado à rede.

### 5.4 Liberar acesso pré-autenticação (Walled Garden)

Em **Pre-Authorization Access**, adicione o IP e porta do servidor desta aplicação (`IP_DO_SERVIDOR:80`) para que o browser do cliente consiga carregar o portal antes de estar autenticado.

> [!IMPORTANT]
> Caso use logotipos ou fundos armazenados em **URLs externas** (ex: LinkedIn, Google Drive), você também deve adicionar esses domínios na lista de Pre-Authorization para que as imagens carreguem antes do login. Recomenda-se o **Upload Local** para evitar este problema.

### 5.5 Fluxo completo após configuração

```
1. Cliente conecta na SSID Guest
2. Tenta acessar qualquer site
3. UniFi redireciona para:
    http://IP_DO_SERVIDOR/guest/s/default/?id=<MAC>&ap=<APMAC>&ssid=<SSID>&url=<originalUrl>
4. Aplicação redireciona internamente para /portal
5. Cliente preenche o formulário (Nome, E-mail, Telefone, CPF)
6. Backend valida, salva no SQLite e chama authorize-guest na UniFi
7. Cliente é redirecionado para PORTAL_SUCCESS_URL ou o site original
```

---

## 7. Customização e Branding

O sistema permite a personalização completa da identidade visual via Painel Administrativo:

- **Nome da Marca**: Altera o título da página e textos do portal.
- **Logotipo**: Upload local ou URL externa.
- **Plano de Fundo**: Imagem de fundo customizada para o portal.
- **Cores**: Defina a cor primária (em Hexadecimal) que será aplicada em botões e elementos de destaque.
- **Termos de Uso**: Editor com suporte a **Markdown** e visualização em Modal otimizado para mobile.

Para configurar, acesse **Painel Admin > Customização**.

---

## 8. Acessando o sistema

| Interface | URL |
|---|---|
| Portal Guest | `http://IP_DO_SERVIDOR/portal` |
| Painel Admin | `http://IP_DO_SERVIDOR/admin` |

A senha do painel admin é a definida em `ADMIN_PASSWORD`.

---

## 9. Estrutura do projeto

```
unifi-captive-portal/
├── prisma/
│   ├── schema.prisma            # Modelo do banco de dados
├── public/
│   └── uploads/                 # Imagens enviadas pelo admin
├── src/
│   ├── app/
│   │   ├── guest/s/[site]/      # Captura o redirect da UniFi
│   │   ├── portal/              # Formulário do captive portal
│   │   ├── admin/               # Painel administrativo
│   │   └── api/                 # Backend (authorize, settings, upload)
│   ├── components/
│   │   ├── portal/TermsModal.tsx
│   │   └── admin/               # Tabelas, cards e gráficos
│   └── lib/
│       ├── unifi.ts             # Cliente HTTP UniFi
│       └── auth.ts              # Sessão admin via HMAC
```

---

## 10. Endpoints da API UniFi utilizados

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/login` | POST | Autentica e obtém cookie de sessão + CSRF token |
| `/api/s/{site}/cmd/stamgr` | POST | `authorize-guest` e `unauthorize-guest` |
| `/api/s/{site}/stat/guest` | GET | Lista sessões ativas com estatísticas |

---

## 11. Banco de dados

O SQLite é criado automaticamente em `prisma/dev.db` na primeira migração.

**Visualizar dados pelo Prisma Studio:**

```bash
npx prisma studio
```

---

## 12. Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| **Logo não aparece** no celular | Bloqueio de URL externa | Faça o **Upload Local** da imagem no Painel Admin > Customização. |
| Portal redireciona mas não abre | IP bloqueado na UniFi | Garanta que o IP do servidor está em "Pre-Authorization Access". |
| `Failed to compile` (Build) | Erro de tipagem ou pasta ausente | Certifique-se de que a pasta `public/uploads` existe e tem permissão de escrita. |

---

## 13. LGPD e Segurança

O sistema foi projetado para conformidade com a LGPD:

- **Termos de Uso**: Exibidos em Modal com rolagem, garantindo que o usuário tenha fácil acesso às políticas.
- **Consentimento**: Registro da aceitação dos termos vinculado ao cadastro do guest.
- **Privacidade**: As informações são armazenadas localmente. Recomenda-se o uso de HTTPS (`COOKIE_SECURE="true"`) se o servidor estiver exposto à internet.
