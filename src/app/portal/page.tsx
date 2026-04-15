import { Suspense } from "react";
import { PortalForm } from "@/components/portal/PortalForm";
import { getSystemSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const settings = await getSystemSettings();
  
  const bgStyle = settings.backgroundUrl 
    ? { backgroundImage: `url(${settings.backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  return (
    <main 
      className="flex min-h-screen items-center justify-center bg-slate-50 p-4"
      style={bgStyle}
    >
      <div className={settings.backgroundUrl ? "absolute inset-0 bg-black/30 backdrop-blur-sm" : ""} />
      <div className="relative z-10 w-full max-w-md">
        <Suspense fallback={<div>Carregando...</div>}>
          <PortalForm settings={settings} />
        </Suspense>
      </div>
    </main>
  );
}
