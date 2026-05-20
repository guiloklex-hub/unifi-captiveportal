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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  // Bypass por Bearer ${CRON_SECRET} para chamadas internas (cron jobs locais).
  // Why: tarefas de manutenção (futuro reconcile/cleanup) precisam rodar sem
  // cookie de admin. Comparação constant-time para evitar timing attack.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.length >= 16) {
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${cronSecret}`;
    if (timingSafeStringEqual(auth, expected)) {
      return NextResponse.next();
    }
  }

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
