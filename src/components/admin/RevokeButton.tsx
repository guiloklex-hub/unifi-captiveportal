"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export function RevokeButton({ mac, dict }: { mac: string; dict: Dictionary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!confirm(`${dict.admin.revokeConfirm} ${mac}?`)) return;
    setError(null);
    const res = await fetch("/api/admin/guests/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mac }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j?.error ?? dict.admin.revokeFail);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="destructive" onClick={onClick} disabled={pending}>
        {dict.admin.revokeBtn}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
