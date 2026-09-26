# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

### Alterado
- Dependências atualizadas: Next 16.3, React 19.3, Prisma 7.10, Zod 4, Recharts 3,
  Tailwind CSS 4, tailwind-merge 3, lucide-react 1, undici 8, @hookform/resolvers 5,
  dotenv 18, TypeScript 6.
- Tailwind migrado para a configuração CSS-first (v4); `tailwindcss-animate` substituído
  por `tw-animate-css`; `autoprefixer` removido (embutido no Tailwind 4).
- `npm audit` zerado (overrides para dependências transitivas do CLI do Prisma).

### Adicionado
- ESLint 9 em flat config (`eslint.config.mjs`) — `next lint` foi removido no Next 16.
- Vitest com testes unitários para validadores, tokens, locks, CSV, máscaras, rate limit e sessão admin.
- CI executa lint, typecheck, testes, migrações e build.
- Configuração do Dependabot para npm e GitHub Actions.
