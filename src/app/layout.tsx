import type { Metadata } from "next";
import { getSystemSettings } from "@/lib/settings";
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
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --primary: ${settings.primaryColor};
            --primary-foreground: 210 40% 98%;
          }
          .bg-primary { background-color: var(--primary) !important; }
          .text-primary { color: var(--primary) !important; }
          .border-primary { border-color: var(--primary) !important; }
          .ring-primary { --tw-ring-color: var(--primary) !important; }
          .bg-primary:hover { filter: brightness(0.9); }
        ` }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
