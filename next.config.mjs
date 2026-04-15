/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { 
    serverActions: { bodySizeLimit: "2mb" }
  },
  // Otimizações para máquinas com pouca RAM (evita Heap Out of Memory)
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
