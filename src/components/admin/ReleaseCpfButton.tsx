"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export function ReleaseCpfButton({ cpf, dict }: { cpf: string; dict: Dictionary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!confirm(dict.admin.releaseCpfConfirm)) return;
    setError(null);
    const res = await fetch("/api/admin/guests/release-cpf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cpf }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j?.error ?? dict.admin.releaseCpfFail);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={onClick} disabled={pending}>
        {dict.admin.releaseCpfBtn}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
