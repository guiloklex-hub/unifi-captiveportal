import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UniFi Captive Portal",
  description: "Portal Guest com integração à controladora Ubiquiti UniFi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
