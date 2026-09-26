import type { Metadata } from "next";
import { getSystemSettings } from "@/lib/settings";
import { contrastForeground } from "@/lib/utils";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSystemSettings();
  return {
    title: settings.brandName,
    description: "Portal Guest com integração à controladora Ubiquiti UniFi",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSystemSettings();

  return (
    <html lang="pt-BR">
      <head>
        {/* Cor da marca sobrescreve o token do Tailwind 4 (`--color-primary`).
            `:root:root` ganha em especificidade do `:root` gerado pelo @theme.
            primaryColor é validado como hex em getSystemSettings(). */}
        <style
          dangerouslySetInnerHTML={{
            __html: `:root:root { --color-primary: ${settings.primaryColor}; --color-primary-foreground: ${contrastForeground(settings.primaryColor)}; --color-ring: ${settings.primaryColor}; }`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
