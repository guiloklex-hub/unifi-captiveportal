import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin/login")) return NextResponse.next();

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  const valid = await verifySessionToken(token);
  if (!valid) {
    const host = req.headers.get("host") || req.nextUrl.host;
    const protocol = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.split(":")[0];
    const loginUrl = `${protocol}://${host}/admin/login?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
