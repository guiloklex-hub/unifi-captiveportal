/**
 * Checagem de ambiente do container, antes das migrações e do servidor.
 *
 *   eval "$(node scripts/docker-preflight.mts)"   (ver docker-entrypoint.sh)
 *
 * Imprime em stdout `export VAR='valor'` para o que precisou ser corrigido e,
 * em stderr, avisos/erros legíveis no `docker logs`. Sai com código 1 quando a
 * configuração impede o painel de funcionar — antes, esses casos subiam o
 * container "saudável" e o login respondia "Credenciais inválidas" com a senha
 * certa (500 sem corpo na rota de login).
 */

export const DOCKER_DATABASE_URL = "file:/data/portal.db";
export const ADMIN_SECRET_PLACEHOLDER = "gere-com-openssl-rand-hex-32";
export const ADMIN_PASSWORD_PLACEHOLDER = "trocar-essa-senha";

export type PreflightResult = {
  /** Variáveis que precisam ser reexportadas com o valor corrigido. */
  exports: Record<string, string>;
  warnings: string[];
  errors: string[];
};

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * `docker run --env-file` não interpreta aspas: `ADMIN_PASSWORD="abc"` chega
 * ao app como `"abc"` (com as aspas). O `docker compose` remove. Normalizamos
 * para os dois caminhos se comportarem igual.
 */
function stripQuotes(value: string): string | null {
  if (value.length < 2) return null;
  const q = value[0];
  if ((q === '"' || q === "'") && value.at(-1) === q) return value.slice(1, -1);
  return null;
}

export function preflight(env: Record<string, string | undefined>): PreflightResult {
  const exports: Record<string, string> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  const value = (k: string) => exports[k] ?? env[k];

  const quoted: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || !ENV_NAME.test(k)) continue;
    const unquoted = stripQuotes(v);
    if (unquoted !== null) {
      exports[k] = unquoted;
      quoted.push(k);
    }
  }
  if (quoted.length) {
    warnings.push(
      `aspas removidas de ${quoted.join(", ")} — "docker run --env-file" não interpreta aspas como o docker compose.`,
    );
  }

  // Relativo, o banco das migrações (/opt/prisma) e o do app (/app) viram arquivos
  // diferentes: o app abre um banco vazio e nada fica no volume /data.
  const db = value("DATABASE_URL") ?? "";
  if (!db.startsWith("file:/")) {
    exports.DATABASE_URL = DOCKER_DATABASE_URL;
    warnings.push(
      `DATABASE_URL="${db}" não é um caminho absoluto; usando ${DOCKER_DATABASE_URL} (volume /data). ` +
        "Remova DATABASE_URL do .env usado no container.",
    );
  }

  const secret = value("ADMIN_SECRET") ?? "";
  if (!secret || secret === ADMIN_SECRET_PLACEHOLDER) {
    errors.push("ADMIN_SECRET não configurado. Gere com: openssl rand -hex 32");
  } else if (secret.length < 32) {
    errors.push(`ADMIN_SECRET tem ${secret.length} caracteres; o mínimo é 32. Gere com: openssl rand -hex 32`);
  }

  const password = value("ADMIN_PASSWORD") ?? "";
  if (!password) {
    warnings.push("ADMIN_PASSWORD vazio: o primeiro acesso ao painel não será possível.");
  } else if (password === ADMIN_PASSWORD_PLACEHOLDER) {
    warnings.push(`ADMIN_PASSWORD ainda é o valor de exemplo ("${ADMIN_PASSWORD_PLACEHOLDER}") — troque-o.`);
  }

  return { exports, warnings, errors };
}

/** Aspas simples no shell: só `'` precisa de escape. */
export function shellExport(name: string, value: string): string {
  return `export ${name}='${value.replaceAll("'", `'\\''`)}'`;
}

if (import.meta.main) {
  const { exports, warnings, errors } = preflight(process.env);
  for (const w of warnings) console.error(`[preflight] AVISO: ${w}`);
  for (const e of errors) console.error(`[preflight] ERRO: ${e}`);
  if (errors.length) {
    console.error("[preflight] corrija o .env e recrie o container (docker compose up -d).");
    process.exit(1);
  }
  for (const [k, v] of Object.entries(exports)) console.log(shellExport(k, v));
}
