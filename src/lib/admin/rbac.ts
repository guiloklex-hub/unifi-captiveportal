/**
 * Papéis do painel:
 *   admin     tudo, inclusive usuários, auditoria, conexão UniFi e Customização
 *   operator  operação do dia a dia: tokens, sessões, bloqueios, reconciliação
 *   viewer    somente leitura (GET) das telas operacionais
 */
export type AdminRole = "admin" | "operator" | "viewer";
export const ADMIN_ROLES: readonly AdminRole[] = ["admin", "operator", "viewer"];

const RANK: Record<AdminRole, number> = { viewer: 0, operator: 1, admin: 2 };

// Áreas exclusivas de admin (páginas e APIs).
const ADMIN_ONLY = [
  "/admin/users",
  "/admin/audit",
  "/admin/unifi",
  "/admin/settings",
  "/api/admin/users",
  "/api/admin/audit",
  "/api/admin/unifi",
  "/api/admin/settings",
  "/api/admin/branding",
  "/api/admin/upload",
  "/api/admin/cleanup",
];

// Rotas que qualquer usuário autenticado acessa (inclusive mutações da própria conta).
const SELF_SERVICE = ["/admin/account", "/api/admin/account", "/api/admin/logout", "/admin/logout"];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function requiredRole(pathname: string, method: string): AdminRole {
  if (matches(pathname, SELF_SERVICE)) return "viewer";
  if (matches(pathname, ADMIN_ONLY)) return "admin";
  return SAFE_METHODS.has(method.toUpperCase()) ? "viewer" : "operator";
}

export function roleAllows(role: AdminRole, required: AdminRole): boolean {
  return RANK[role] >= RANK[required];
}

export function isAdminRole(v: unknown): v is AdminRole {
  return (ADMIN_ROLES as readonly unknown[]).includes(v);
}
