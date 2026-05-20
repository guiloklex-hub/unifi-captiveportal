import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";

// Allowlist de endpoints públicos cobertos pelo matcher.
// Why: login/logout não podem exigir sessão válida (login a cria, logout a destrói).
const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/api/admin/login",
  "/api/admin/logout",
  "/admin/logout",
]);

// Métodos que mudam estado — passam por checagem de Origin/Referer para
// defesa contra CSRF cross-site. GET/HEAD/OPTIONS são considerados safe.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

// Comparação constant-time em string (sem Node crypto, compatível com Edge).
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Bypass por Bearer ${CRON_SECRET} para chamadas internas (cron jobs locais).
  // Why: tarefas de manutenção precisam rodar sem cookie de admin e sem Origin.
  // Avaliado antes da allowlist e da checagem CSRF para que cron/scripts
  // internos não fiquem sujeitos a checagem de Origin nem de método.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.length >= 16) {
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${cronSecret}`;
    if (timingSafeStringEqual(auth, expected)) {
      return NextResponse.next();
    }
  }

  // Defesa CSRF para requests que mudam estado em /api/admin/*.
  // Vale também para /api/admin/login — impede login forjado cross-site.
  if (STATE_CHANGING.has(method) && isApi(pathname) && !isSameOrigin(req)) {
    return NextResponse.json({ error: "Origem inválida" }, { status: 403 });
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  const valid = await verifySessionToken(token);
  if (valid) return NextResponse.next();

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
