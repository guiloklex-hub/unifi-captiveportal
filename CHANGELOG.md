# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

### Adicionado
- **Docker**: imagem multi-stage (Next standalone, usuário não-root, migrações no boot, health check) e
  `docker-compose.yml`; CI constrói a imagem e faz smoke test.
- **Testes E2E** com Playwright contra a controladora simulada (portal, painel, vouchers, conexão UniFi, login).
- Guia de atualização de versões anteriores, exemplo de nginx/HTTPS (`docs/nginx.md`) e README reorganizado.
- **Integrações** (menu Integrações): webhooks assinados (HMAC-SHA256, retentativas, teste pelo painel) para
  `guest.authorized`, `guest.revoked` e `rule.created`; **API pública v1** com chaves e escopos (métricas, sessões,
  cadastros, criação de vouchers e liberação de dispositivos); **relatório por e-mail** diário/semanal.
  Guia em `docs/integracoes.md`.
- **LGPD** (menu Privacidade): versão dos termos aceita por cadastro (hash + texto arquivado), consentimento de
  marketing separado e opcional, exportação (JSON) e anonimização de dados por titular, retenção de dados pessoais
  (`PII_RETENTION_DAYS`) separada do registro de conexão, mascaramento de PII para o papel "Somente leitura".
  Convidado recorrente precisa aceitar de novo quando os termos mudam.
- **Usuários do painel com papéis** (Administrador, Operador, Somente leitura), senhas com scrypt, bloqueio após
  5 tentativas e **2FA TOTP** por usuário. RBAC aplicado no `proxy.ts` a páginas e APIs.
- **Trilha de auditoria** de todas as ações administrativas, com filtro e exportação CSV.
- **Bloqueios e liberações**: bloquear por MAC/CPF/e-mail/documento; liberar dispositivo (1 clique, sem cadastro);
  **liberar agora** aparelhos sem navegador (TV, impressora); **estender** e **bloquear** direto na tela de Sessões.
- **Verificação por código** (opcional) por **e-mail** (SMTP, com acesso provisório para ler o e-mail) ou **SMS**
  (Twilio ou webhook genérico). Código de 6 dígitos, uso único, 10 min, 5 tentativas; guardado só como HMAC.
- **Login social** (opcional) com **Google** e **Microsoft** (OAuth 2.0/OIDC + PKCE): nome e e-mail verificados
  pelo provedor.
- Limpeza diária também remove códigos e logins sociais com mais de 24 h.
- **Formas de acesso opcionais** (Customização), todas desligadas por padrão:
  formulário configurável (obrigatório/opcional/não pedir por campo), **acesso rápido** (só termos),
  **estrangeiros sem CPF** (passaporte + telefone internacional), **convidado recorrente** (reconexão em 1 clique),
  **perfil padrão de acesso** editável no painel, **marca por site** e **pré-visualização do portal**.
- **Vouchers em lote** (até 500) com **folha de impressão A4** (QR code, código, tempo, validade e rede).
- Busca do MAC pelo IP do cliente quando o portal é aberto sem `?id=` (QR code lido pela câmera).
- Dashboard: gráfico "Formas de acesso"; visitantes únicos por chave de visitante (CPF → documento → e-mail → MAC).
- Logs/CSV: documento estrangeiro e forma de acesso; busca por documento e MAC.
- **Conexão UniFi por API Key** (API oficial *Integration API*, Network 9+) — sem usuário/senha, sessão ou CSRF.
  Modos `UNIFI_AUTH_MODE=auto|apikey|password`; no `auto`, fallback automático
  API oficial → API legada com API Key → API legada com usuário/senha.
- Compatibilidade mantida com **todas as versões**: Network Application clássica (self-hosted) e UniFi OS.
- Tela **Conexão UniFi** (`/admin/unifi`): configurar URL/site/modo/API Key/usuário e senha pelo painel, com
  **Testar conexão** (tipo de controladora, versão, sites, estratégia ativa) sem afetar os guests.
  Segredos cifrados com AES-256-GCM (`DATA_ENCRYPTION_KEY`).
- Nome do AP nas sessões ativas; filtros de site incluem os sites da controladora.
- `npm run mock:unifi`: controladora simulada (UniFi OS ou Classic) para desenvolvimento sem hardware.
- ESLint 9 em flat config (`eslint.config.mjs`) — `next lint` foi removido no Next 16.
- Vitest com testes unitários para validadores, tokens, locks, CSV, máscaras, rate limit e sessão admin.
- CI executa lint, typecheck, testes, migrações e build.
- Configuração do Dependabot para npm e GitHub Actions.

### Alterado
- CI: `actions/checkout`, `actions/setup-node` e `actions/upload-artifact` na v7 (runtime Node 24).
- **Login do painel**: `ADMIN_PASSWORD` vira senha de primeiro acesso (bootstrap); após criar o primeiro usuário,
  o login passa a ser por usuário e senha. `ADMIN_BREAK_GLASS=true` reabre o acesso de emergência.
  Sessões abertas antes da atualização precisam entrar de novo (novo formato de token).
- Logout apenas por `POST` (um `GET` permitia deslogar o admin via CSRF).
- Fluxo de liberação unificado em `src/lib/portal/grantAccess.ts` (formulário, recorrente e, na sequência, OTP/login social).
- Cliente UniFi reorganizado em `src/lib/unifi/` (config, transporte, API legada, API oficial, fachada).
  Sessão, circuit breaker e caches agora são únicos por processo (antes cada rota do Next tinha os seus).
- **Retenção padrão de logs: 365 dias** (Marco Civil da Internet, art. 13). Antes: 180.
- Settings com cache em memória (30 s, invalidado ao salvar) — antes havia uma escrita no SQLite por page view.
- Reconciliação UniFi ↔ DB com uma consulta para todos os MACs (antes N+1).
- Cabeçalhos de segurança HTTP em todas as rotas e `X-Powered-By` removido.
- Páginas do painel movidas para o route group `src/app/admin/(panel)/` (URLs inalteradas).
- Dependências atualizadas: Next 16.3, React 19.3, Prisma 7.10, Zod 4, Recharts 3,
  Tailwind CSS 4, tailwind-merge 3, lucide-react 1, undici 8, @hookform/resolvers 5,
  dotenv 18, TypeScript 6.
- Tailwind migrado para a configuração CSS-first (v4); `tailwindcss-animate` substituído
  por `tw-animate-css`; `autoprefixer` removido (embutido no Tailwind 4).
- `npm audit` zerado (overrides para dependências transitivas do CLI do Prisma).

### Segurança
- **IP do cliente não é mais forjável** (`scripts/client-ip.cjs`): `X-Real-IP`/`X-Forwarded-For`/`CF-Connecting-IP`
  só valem vindos de proxy confiável (`TRUST_PROXY`, padrão loopback). Antes, trocar o cabeçalho burlava o rate limit
  do login (inclusive do `ADMIN_PASSWORD`, sem bloqueio por conta) e gravava IP falso nos logs de conexão.
- **`ADMIN_ALLOWED_NETWORKS`**: o painel responde 404 fora das redes administrativas — com portal externo a UniFi
  libera o IP do portal (e portanto o painel) para convidados ainda não autenticados.
- **OTP**: intervalo de reenvio também por destinatário e no máximo 5 códigos por telefone/e-mail em 24 h
  (o limite só por MAC, informado pelo cliente, permitia disparo em massa de SMS).
- **`CRON_SECRET`** passa a valer só em `POST /api/admin/cleanup` e `/api/admin/reports/send` (antes: todo o painel).
- Login com usuário inexistente leva o mesmo tempo (scrypt de fachada) — não revela quais usuários existem.
- CSP mínima (`frame-ancestors`, `base-uri`, `object-src`, `form-action`); `/api/healthz` só mostra detalhes para
  o próprio servidor e `ADMIN_ALLOWED_NETWORKS`.
- Removidas as dependências sem uso `date-fns` e `@radix-ui/react-toast`.

### Corrigido
- **Docker — login do painel recusava a senha certa** ("Credenciais inválidas"): com o `ADMIN_SECRET` de
  exemplo (28 caracteres) ou com `docker run --env-file` (aspas mantidas e `DATABASE_URL` relativo apontando
  para um banco vazio), a rota de login dava 500 sem corpo. O entrypoint agora valida o ambiente
  (`scripts/docker-preflight.mts`): recusa subir sem `ADMIN_SECRET` válido, remove aspas e força o banco em
  `/data`. Erros do servidor no login passam a aparecer como tal na tela, não como senha errada.
- Formulário do portal só mostrava os erros de campo (ex.: "CPF inválido") depois que os termos eram marcados.
- Logo com URL externa quebrava o portal (`next/image` sem `remotePatterns`).
- O QR code do token abria o portal sem MAC ("Acesso indisponível").
- "Dispositivos online agora" contava guests expirados/não autorizados.
- Falhas de configuração/credencial da controladora mostram ao guest "serviço indisponível" (antes: erro genérico).
- **Multi-site**: o site do caminho `/guest/s/<site>/` enviado pela controladora era descartado — todo guest era
  autorizado no `UNIFI_SITE` padrão. Agora é repassado ao portal.
- **Revogação multi-site**: "Desconectar" e "Liberar CPF" usavam sempre o site padrão; agora usam o site da sessão.
  "Desconectar" também marca a sessão como revogada no banco (libera o bloqueio de CPF).
- **Upload de imagens**: nome do arquivo vindo do cliente permitia gravar fora de `public/uploads` (path traversal);
  SVG permitia XSS armazenado; sem limite de tamanho. Agora: PNG/JPEG/WebP/GIF detectados por magic bytes, até 5 MB,
  nome gerado no servidor.
- **Leitura de uploads** validava pouco o nome do arquivo; agora bloqueia traversal e envia `nosniff`
  (SVGs legados em sandbox via CSP).
- **Logo enviado não podia ser salvo**: o validador de settings só aceitava `/uploads/...`, mas o upload devolve
  `/api/uploads/...`.
- **Login do admin**: marca (logo/nome) nunca aparecia (a página buscava uma API que exige sessão); o menu lateral
  do painel aparecia na tela de login; o parâmetro `?next=` permitia open redirect e `javascript:`.
- **Rate limit do portal**: sem proxy reverso, todos os guests compartilhavam o mesmo limite (10/min no total).
- **Cor primária**: o CSS gerava `hsl(#hex)` inválido e dependia de `!important`; agora sobrescreve o token do
  Tailwind e ajusta a cor do texto para contraste.
- `TOKEN_LOCK_REQUIRE` só tinha efeito no portal depois que o admin salvasse a tela de Customização.
- Sessões ativas listavam guests expirados que o `/stat/guest` ainda retorna.
- Parâmetro `site` agora é validado antes de ir para o path da API da controladora (evita path injection).
- Mensagens de erro do portal não expõem mais detalhes internos da controladora e estão traduzidas (PT/EN/ES).

---

## Histórico — atualizações (Junho 2026)

#### QR Code do token (deep-link)
- Cada token agora tem um **QR code** disponível no painel admin (`/admin/tokens`).
- Escanear o QR abre o portal já com o campo "Token de acesso" preenchido — o convidado só precisa completar nome/email/CPF.
- Endpoint: `GET /api/admin/tokens/{id}/qr` (SVG por padrão; `?format=png` para PNG). Header `X-Token-DeepLink` retorna a URL embutida.
- Deep-link gerado: `${PUBLIC_PORTAL_URL ?? host}/guest/s/{site}?token={code}`. Configure `PUBLIC_PORTAL_URL` (seção 5.1) com o domínio público para que o QR aponte para a URL real que o convidado consegue acessar.
- Adiciona dependência `qrcode` (~50KB) + `@types/qrcode`.

#### Indicadores ao vivo no dashboard
- Nova seção `LiveCounters` no topo de `/admin` com 4 KPIs que se atualizam a cada 15s:
  - **Tokens emitidos · 24h** — `accessToken.count` na janela.
  - **Dispositivos online agora** — `listActiveGuests()` direto na controladora (graceful fallback para `—` quando a UniFi está down, não derruba o painel).
  - **Tráfego processado · 24h** — soma de `bytesTx + bytesRx` em `GuestRegistration` na janela.
  - **Uptime do serviço** — `process.uptime()`.
- Endpoint: `GET /api/admin/live-metrics`.

#### Filtro multi-site no painel
- Dropdown `SiteFilter` no topo de `/admin`, `/admin/logs` e `/admin/sessions`. Lista sites distintos derivados de `GuestRegistration.site` ∪ `AccessToken.site`.
- Estado vive na query string (`?site=event-2026`), persiste entre navegações no admin. Selecionar "Todos os sites" remove o filtro.
- `/api/admin/logs?site=...` (e CSV) aplicam o filtro; `/admin/sessions?site=...` repassa para `listActiveGuests(site)`; o dashboard propaga o filtro para todas as queries Prisma de `GuestRegistration` e `AccessToken`.
- Endpoint: `GET /api/admin/sites` retorna `{ sites: [...] }`.

---

## Histórico — atualizações (Maio 2026)

#### Dashboard ampliado — BI mais rico (sem novas dependências)
- **Painel de tráfego (últimos 30 dias)** — totais de download/upload reconciliados, média por sessão, série temporal em `AreaChart` empilhada (TX/RX) e **top 10 consumidores** por CPF (nome, CPF mascarado, volume, sessões).
- **Heatmap hora × dia da semana** — grade 7×24 com gradação de cor por intensidade, tooltips por célula. Substitui a leitura "linear" do pie de horários de pico por uma visualização de padrões semanais.
- **Análise de dispositivos** — três donuts (sistema operacional, navegador, tipo de dispositivo) gerados via parser regex de `userAgent` em [src/lib/ua-parser.ts](src/lib/ua-parser.ts), sem dependência externa.
- **Fingerprint analytics** — KPIs de fingerprints únicos + média por CPF + tabela de fingerprints **suspeitos** (mesmo fingerprint observado em CPFs distintos no período → sinal de compartilhamento ou spoofing).
- **Tokens enriquecidos** — além das contagens existentes: **taxa média de aproveitamento** (`usedCount/maxUses`), **bytes consumidos por token** (últimos 30d) e lista de **tokens criados há >7d sem nenhum uso** (estoque parado para revisar antes de expirar).
- Helpers reutilizáveis: [src/lib/format.ts](src/lib/format.ts) (`formatBytes`, `maskCpf`, `bigIntToNumber`).
- Tudo computado a partir dos dados já capturados (`bytesTx/bytesRx`, `userAgent`, `fingerprint`, `tokenId`); sem novas tabelas, sem nova migration.

## Histórico — atualizações (Abril 2026)

#### Sistema de tokens de acesso
- **Tokens criados pelo admin** com parâmetros próprios: duração da sessão, banda (down/up Kbps), quota de dados (MB), data/hora de expiração e número máximo de usos.
- **Toggle global** "Exigir token de acesso" no painel — quando ativo, o campo aparece no formulário do guest; quando desativo, o fluxo padrão (apenas dados pessoais) é preservado.
- **Locks via `.env`** — variáveis `TOKEN_LOCK_*` travam campos individuais do formulário admin (útil para padronizar políticas em deploys multi-cliente).
- **Geração de código** com `crypto.randomBytes(12)` em base32 sem caracteres ambíguos (formato `XXXX-XXXX-XXXX`).
- **Atomicidade**: reserva de uso via raw SQL `UPDATE ... WHERE usedCount < maxUses` evita race condition entre guests competindo pelo último uso.
- **Idempotência**: re-autorização do mesmo MAC no mesmo dia não consome uso adicional do token.
- **Compensação**: se a UniFi falhar após reserva, o uso é liberado automaticamente.
- **Renovação** ("estender") — admin pode adicionar minutos à validade e/ou usos extras a tokens ainda ativos.
- **Revogação em cascata** — ao revogar um token, opção de desconectar via UniFi todos os guests ativos que o usaram.

#### Multi-site UniFi
- Cada token pode ser vinculado a um site específico da controladora; valor padrão `default`.
- `authorizeGuest`, `unauthorizeGuest` e `listActiveGuests` aceitam parâmetro `site` opcional, com fallback para `UNIFI_SITE` do `.env`.

#### Métricas e auditoria
- **Dashboard de tokens**: contagens por status (ativo/expirado/revogado/esgotado), tempo médio até primeiro uso, top 5 tokens mais utilizados.
- **Coluna Token nos logs** (UI + CSV) — admin enxerga qual token autorizou cada guest.
- **Endpoint de métricas dedicado** `/api/admin/tokens/metrics` para integrações.
- **Reconciliação UniFi ↔ DB** — endpoint `POST /api/admin/reconcile` atualiza `bytesTx`, `bytesRx`, `lastSeenAt` consultando `/stat/guest`.

#### Segurança
- **Fingerprint do dispositivo** (SHA-256 de UA + idioma + timezone + plataforma + tela + memória) gravado em cada autorização — sinal de defesa em profundidade contra MAC spoofing. Logs de warning quando o mesmo MAC + token retorna fingerprint diferente.
- **Quota de dados** (`bytesQuotaMB`) agora persistida no `GuestRegistration` para auditoria.
- **Endpoint público de sessão** `/api/portal/session/[id]` devolve apenas dados não-sensíveis (sem PII), com janela de 5 min após autorização.

#### UX
- **Tela de sucesso enriquecida** — mostra tempo restante (atualizado a cada 30s), duração total, banda, quota e SSID.
- **Máscara de token** no formulário — formatação automática `XXXX-XXXX-XXXX`, `autoCapitalize="characters"`, `spellCheck=false`.
- **Tradução completa** das novas funcionalidades para PT/EN/ES.

#### Bloqueio de 1 dispositivo por CPF
- **Toggle global** "Limitar a 1 dispositivo por CPF" em `SystemSettings` (default desligado) — impede que o mesmo CPF autorize um segundo MAC enquanto a sessão atual estiver viva (`authorizedAt + durationMin > agora`).
- **Mesmo MAC sempre passa**: reautorização do dispositivo já registrado é idempotente (refresh, troca de dia, etc.).
- **Bypass por token**: quando `requireToken=true` e o cliente apresenta token válido, o bloqueio não se aplica — o admin já controla via emissão do token.
- **Override do admin**: botão "Liberar CPF" em `/admin/sessions` marca as sessões vivas como revogadas (`revokedAt`) e dispara `unauthorize` na UniFi (best-effort).
- **Auditoria**: campo `GuestRegistration.revokedAt` distingue revogação manual de expiração natural, sem sujar `durationMin`.

#### Correções
- **`UniFiUnavailableError`** corretamente reconhecida em catch (estava sendo coberta apenas pelo `export {}` no fim do arquivo — confirmamos funcionalidade).
- **Filtro de payload UniFi** agora usa `typeof === "number" && > 0` em vez de truthy-coercion (`if (opts.upKbps)`), preservando intenção de "sem limite" via `0`/ausente.
- **`prisma.$executeRaw`** convertido para `Number()` antes da comparação — defesa contra drivers que retornem `bigint`.
- **Idempotência da reserva de token** — refresh do navegador / retentativa no mesmo dia não consome usos extras.
