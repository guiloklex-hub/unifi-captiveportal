"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Aceita apenas URLs http(s) absolutas como alvo de redirect.
 * Se inválido, retorna null e a página permanece na tela de sucesso local
 * — garantindo que nunca vejamos `data:text/html,` / tela branca.
 */
function safeTarget(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

function SuccessInner({ dict }: { dict: Dictionary }) {
  const params = useSearchParams();
  const target = safeTarget(params.get("url"));
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!target) return;
    setRedirecting(true);
    const t = setTimeout(() => {
      window.location.href = target;
    }, 2500);
    return () => clearTimeout(t);
  }, [target]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100 p-6 text-center">
      <div className="rounded-2xl border bg-white p-10 shadow-sm max-w-md">
        <h1 className="text-2xl font-bold text-emerald-700">{dict.portal.successTitle}</h1>
        <p className="mt-2 text-muted-foreground">{dict.portal.successDesc}</p>
        {redirecting && target && (
          <p className="mt-4 text-xs text-slate-500 break-all">{target}</p>
        )}
      </div>
    </main>
  );
}

export function SuccessClient({ dict }: { dict: Dictionary }) {
  return (
    <Suspense fallback={null}>
      <SuccessInner dict={dict} />
    </Suspense>
  );
}
