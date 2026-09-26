/**
 * Cabeçalhos de segurança aplicados a todas as rotas. O portal não precisa
 * ser embutido em iframes (anti-clickjacking) e não usa câmera/microfone/GPS.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Imagem Docker: servidor "standalone" (só as dependências usadas em runtime).
  // Instalações com PM2 continuam usando `next start` normalmente.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
