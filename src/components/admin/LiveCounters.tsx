"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/admin/StatCard";
import { formatBytes } from "@/lib/format";
import type { Dictionary, Locale } from "@/lib/i18n/dictionaries";

type LiveMetrics = {
  tokens24h: number | null;
  onlineNow: number | null;
  traffic24hBytes: number | null;
  uptimeSec: number;
  checkedAt: string;
};

const REFRESH_MS = 15_000;

function formatUptime(sec: number, locale: Locale): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0m";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const dl = locale === "en" ? "d" : "d";
  const hl = "h";
  const ml = "m";
  if (d > 0) return `${d}${dl} ${h}${hl}`;
  if (h > 0) return `${h}${hl} ${m}${ml}`;
  return `${m}${ml}`;
}

function formatNumber(n: number | null, intl: string, fallback: string): string {
  if (n === null || !Number.isFinite(n)) return fallback;
  return n.toLocaleString(intl);
}

export function LiveCounters({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const [data, setData] = useState<LiveMetrics | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/admin/live-metrics", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as LiveMetrics;
        if (!cancelled) setData(json);
      } catch {
        // best-effort: mantém o último valor conhecido em vez de derrubar a UI
      }
    };

    load();
    const id = setInterval(load, REFRESH_MS);

    // tick a cada 30s para o uptime "andar" mesmo entre fetches
    const uptimeTick = setInterval(() => setTick((t) => t + 1), 30_000);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(uptimeTick);
    };
  }, []);

  const intl = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";
  const fallback = dict.admin.liveUnavailable;

  const uptimeBase = data?.uptimeSec ?? 0;
  const uptimeDisplay = data ? formatUptime(uptimeBase + tick * 30, locale) : fallback;
  const traffic = data?.traffic24hBytes;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={dict.admin.liveTokens24h}
        value={formatNumber(data?.tokens24h ?? null, intl, fallback)}
      />
      <StatCard
        title={dict.admin.liveOnlineNow}
        value={formatNumber(data?.onlineNow ?? null, intl, fallback)}
      />
      <StatCard
        title={dict.admin.liveTraffic24h}
        value={traffic == null ? fallback : formatBytes(traffic, locale)}
      />
      <StatCard
        title={dict.admin.liveUptime}
        value={uptimeDisplay}
      />
    </div>
  );
}
