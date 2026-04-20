/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { 
    serverActions: { bodySizeLimit: "2mb" }
  },
};
export default nextConfig;
