"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Globe2 } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries";

const ALL_VALUE = "all";

export function SiteFilter({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sites, setSites] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const current = params.get("site") ?? ALL_VALUE;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/sites")
      .then((r) => (r.ok ? r.json() : { sites: [] }))
      .then((data: { sites: string[] }) => {
        if (!cancelled) setSites(data.sites ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === ALL_VALUE) next.delete("site");
    else next.set("site", value);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  if (sites.length === 0) return null;

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <Globe2 className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground hidden sm:inline">{dict.admin.siteFilterLabel}:</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={current}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={ALL_VALUE}>{dict.admin.siteFilterAll}</option>
        {sites.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
