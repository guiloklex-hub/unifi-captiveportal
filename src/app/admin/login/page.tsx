import { Suspense } from "react";
import { getSystemSettings } from "@/lib/settings";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

// Server component: a marca é lida direto do banco. Antes a página buscava
// /api/admin/settings no cliente, que exige sessão → logo/nome nunca apareciam.
export default async function AdminLoginPage() {
  const settings = await getSystemSettings();
  return (
    <Suspense fallback={null}>
      <LoginForm brandName={settings.brandName} logoUrl={settings.logoUrl} />
    </Suspense>
  );
}
