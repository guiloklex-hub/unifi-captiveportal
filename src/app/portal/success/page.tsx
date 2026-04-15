"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function SuccessContent() {
  const params = useSearchParams();
  const target = params.get("url") || "https://www.google.com";

  useEffect(() => {
    const t = setTimeout(() => {
      window.location.href = target;
    }, 2500);
    return () => clearTimeout(t);
  }, [target]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100 p-6 text-center">
      <div className="rounded-2xl border bg-white p-10 shadow-sm">
        <h1 className="text-2xl font-bold text-emerald-700">Conexão liberada!</h1>
        <p className="mt-2 text-muted-foreground">
          Você já pode navegar. Redirecionando em instantes...
        </p>
      </div>
    </main>
  );
}

export default function PortalSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessContent />
    </Suspense>
  );
}
