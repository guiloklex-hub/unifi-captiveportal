# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

### Adicionado
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

### Corrigido
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
