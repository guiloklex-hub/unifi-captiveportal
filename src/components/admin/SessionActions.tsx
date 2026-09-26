"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return j?.error ?? `HTTP ${res.status}`;
}

/** Estende a sessão por N minutos a partir de agora. */
export function ExtendButton({ mac, site, dict }: { mac: string; site?: string | null; dict: Dictionary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    const raw = prompt(dict.admin.sessionsExtendPrompt, "60");
    const minutes = Number(raw);
    if (!raw || !Number.isFinite(minutes) || minutes <= 0) return;
    setError(await post("/api/admin/guests/extend", { mac, site: site ?? null, minutes }));
    startTransition(() => router.refresh());
  };

  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="outline" onClick={onClick} disabled={pending}>
        {dict.admin.sessionsExtendBtn}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** Bloqueia o dispositivo (regra por MAC) e o desconecta. */
export function BlockButton({ mac, site, dict }: { mac: string; site?: string | null; dict: Dictionary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    const reason = prompt(dict.admin.sessionsBlockPrompt.replace("{mac}", mac));
    if (reason === null) return;
    const err =
      (await post("/api/admin/access-rules", { kind: "block", matchType: "mac", value: mac, reason: reason || null })) ??
      (await post("/api/admin/guests/revoke", { mac, site: site ?? null }));
    setError(err);
    startTransition(() => router.refresh());
  };

  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="ghost" className="text-destructive" onClick={onClick} disabled={pending}>
        {dict.admin.sessionsBlockBtn}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
