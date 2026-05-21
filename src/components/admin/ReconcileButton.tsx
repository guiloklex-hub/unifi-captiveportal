"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export function ReconcileButton({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    setStatus(dict.admin.reconcileRunning);
    try {
      const res = await fetch("/api/admin/reconcile", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setStatus(null);
        setError(j?.error ?? dict.admin.reconcileFail);
        return;
      }
      const data = (await res.json().catch(() => null)) as { updated?: number } | null;
      const updated = data?.updated ?? 0;
      setStatus(dict.admin.reconcileDone.replace("{n}", String(updated)));
      startTransition(() => router.refresh());
    } catch {
      setStatus(null);
      setError(dict.admin.reconcileFail);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" onClick={onClick} disabled={pending}>
        {pending ? dict.admin.reconcileRunning : dict.admin.reconcileBtn}
      </Button>
      {status && !error && (
        <span className="text-xs text-muted-foreground">{status}</span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
