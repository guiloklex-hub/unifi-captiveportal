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

type SessionDetails = {
  authorizedAt: string;
  expiresAt: string;
  durationMin: number;
  downKbps: number | null;
  upKbps: number | null;
  bytesQuotaMB: number | null;
  ssid: string | null;
  site: string | null;
};

function formatRemaining(expiresAtIso: string): string {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return "0min";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}min`;
  return `${m}min`;
}

function SuccessInner({ dict }: { dict: Dictionary }) {
  const params = useSearchParams();
  const target = safeTarget(params.get("url"));
  const sessionId = params.get("id");
  const [redirecting, setRedirecting] = useState(false);
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/portal/session/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetails(d))
      .catch(() => undefined);
  }, [sessionId]);

  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!target) return;
    setRedirecting(true);
    const t = setTimeout(() => {
      window.location.href = target;
    }, 4500);
    return () => clearTimeout(t);
  }, [target]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100 p-6 text-center">
      <div className="rounded-2xl border bg-white p-8 shadow-sm w-full max-w-md">
        <h1 className="text-2xl font-bold text-emerald-700">{dict.portal.successTitle}</h1>
        <p className="mt-2 text-muted-foreground">{dict.portal.successDesc}</p>

        {details && (
          <dl className="mt-6 grid grid-cols-2 gap-3 text-left text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{dict.portal.successRemaining}</dt>
              <dd className="font-medium" data-tick={tick}>{formatRemaining(details.expiresAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{dict.portal.successDuration}</dt>
              <dd className="font-medium">{details.durationMin} min</dd>
            </div>
            {details.downKbps && (
              <div>
                <dt className="text-xs text-muted-foreground">{dict.portal.successDown}</dt>
                <dd className="font-medium">{(details.downKbps / 1024).toFixed(1)} Mbps</dd>
              </div>
            )}
            {details.upKbps && (
              <div>
                <dt className="text-xs text-muted-foreground">{dict.portal.successUp}</dt>
                <dd className="font-medium">{(details.upKbps / 1024).toFixed(1)} Mbps</dd>
              </div>
            )}
            {details.bytesQuotaMB && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">{dict.portal.successQuota}</dt>
                <dd className="font-medium">{details.bytesQuotaMB} MB</dd>
              </div>
            )}
            {details.ssid && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">{dict.portal.successSsid}</dt>
                <dd className="font-medium">{details.ssid}</dd>
              </div>
            )}
          </dl>
        )}

        {redirecting && target && (
          <p className="mt-6 text-xs text-slate-500 break-all">{target}</p>
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
