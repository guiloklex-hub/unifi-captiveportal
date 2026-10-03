import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";
import { getAdminSession } from "@/lib/admin/session";
import { requiredRole, roleAllows } from "@/lib/admin/rbac";
import { ACTOR_HEADER, ROLE_HEADER } from "@/lib/admin/audit";
import { adminNetworkAllowed } from "@/lib/adminNetworks";
import { clientIp } from "@/lib/rateLimit";

// Allowlist de endpoints públicos cobertos pelo matcher.
// Why: login/logout não podem exigir sessão válida (login a cria, logout a destrói).
const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/api/admin/login",
  "/api/admin/login/mfa",
  "/api/admin/logout",
  "/admin/logout",
]);

// Métodos que mudam estado — passam por checagem de Origin/Referer para
// defesa contra CSRF cross-site. GET/HEAD/OPTIONS são considerados safe.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Únicas rotas que o Bearer CRON_SECRET destrava — antes valia para todo o painel.
const CRON_PATHS = new Set(["/api/admin/cleanup", "/api/admin/reports/send"]);

function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

// Comparação constant-time em string.
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Aceita a requisição quando Origin OU Referer batem com o Host do request.
 * Recusa quando ambos faltam ou divergem (CSRF cross-site real).
 */
function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  const originHost = safeHost(req.headers.get("origin"));
  const refererHost = safeHost(req.headers.get("referer"));
  if (originHost && originHost === host) return true;
  if (refererHost && refererHost === host) return true;
  return false;
}

/** Repassa a identidade para as rotas (auditoria) — sobrescreve valores forjados pelo cliente. */
function withIdentity(req: NextRequest, user: string, role: string): NextResponse {
  const headers = new Headers(req.headers);
  headers.set(ACTOR_HEADER, user);
  headers.set(ROLE_HEADER, role);
  return NextResponse.next({ request: { headers } });
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Fora de ADMIN_ALLOWED_NETWORKS o painel "não existe" (ex.: rede de convidados).
  if (!adminNetworkAllowed(clientIp(req.headers))) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Bypass por Bearer ${CRON_SECRET} para chamadas internas (cron jobs locais).
  // Why: tarefas de manutenção precisam rodar sem cookie de admin e sem Origin.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.length >= 16 && method === "POST" && CRON_PATHS.has(pathname)) {
    const auth = req.headers.get("authorization") ?? "";
    if (timingSafeStringEqual(auth, `Bearer ${cronSecret}`)) {
      return withIdentity(req, "cron", "admin");
    }
  }

  // Defesa CSRF para requests que mudam estado em /api/admin/*.
  // Vale também para /api/admin/login — impede login forjado cross-site.
  if (STATE_CHANGING.has(method) && isApi(pathname) && !isSameOrigin(req)) {
    return NextResponse.json({ error: "Origem inválida" }, { status: 403 });
  }

  if (PUBLIC_PATHS.has(pathname)) {
    // Remove identidade forjada mesmo em rotas públicas.
    const headers = new Headers(req.headers);
    headers.delete(ACTOR_HEADER);
    headers.delete(ROLE_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  const session = await getAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
  if (session) {
    if (!roleAllows(session.role, requiredRole(pathname, method))) {
      if (isApi(pathname)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
      return NextResponse.redirect(new URL("/admin?forbidden=1", req.url));
    }
    return withIdentity(req, session.username, session.role);
  }

  // APIs respondem 401 puro; páginas redirecionam para a tela de login.
  if (isApi(pathname)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const host = req.headers.get("host") || req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.split(":")[0];
  const loginUrl = `${protocol}://${host}/admin/login?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
