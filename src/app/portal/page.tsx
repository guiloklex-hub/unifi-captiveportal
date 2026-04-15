import { Suspense } from "react";
import { PortalForm } from "@/components/portal/PortalForm";

export const dynamic = "force-dynamic";

export default function PortalPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 p-4">
      <Suspense fallback={<div>Carregando...</div>}>
        <PortalForm />
      </Suspense>
    </main>
  );
}
