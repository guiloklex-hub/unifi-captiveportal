import { headers } from "next/headers";
import { getLocale, dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/admin/StatCard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ConnectionsLineChart,
  PeakHoursPieChart,
  RetentionBarChart,
  BytesAreaChart,
  DeviceBreakdownPie,
  HourlyHeatmap,
} from "@/components/admin/charts/Charts";
import { parseUserAgent, deviceKindLabel, type DeviceKind } from "@/lib/ua-parser";
import { formatBytes, maskCpf, bigIntToNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type RecentRow = {
  authorizedAt: Date;
  cpf: string;
  fullName: string;
  bytesTx: bigint | null;
  bytesRx: bigint | null;
  fingerprint: string | null;
  userAgent: string | null;
  tokenId: string | null;
};

type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

const WEEKDAY_KEYS = [
  "weekShortSun",
  "weekShortMon",
  "weekShortTue",
  "weekShortWed",
  "weekShortThu",
  "weekShortFri",
  "weekShortSat",
] as const;

function entriesToTopN<K>(map: Map<K, number>, n: number): { label: K; value: number }[] {
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

async function loadDashboard(locale: Locale) {
  const dict = dictionaries[locale];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const last30 = new Date();
  last30.setDate(last30.getDate() - 29);
  last30.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [total, todayCount, distinctCpfs, recent, allBefore, allTokens] = await Promise.all([
    prisma.guestRegistration.count(),
    prisma.guestRegistration.count({ where: { authorizedAt: { gte: startOfToday } } }),
    prisma.guestRegistration
      .findMany({ select: { cpf: true }, distinct: ["cpf"] })
      .then((r) => r.length),
    prisma.guestRegistration.findMany({
      where: { authorizedAt: { gte: last30 } },
      select: {
        authorizedAt: true,
        cpf: true,
        fullName: true,
        bytesTx: true,
        bytesRx: true,
        fingerprint: true,
        userAgent: true,
        tokenId: true,
      },
      orderBy: { authorizedAt: "asc" },
    }),
    prisma.guestRegistration.findMany({
      where: { authorizedAt: { lt: last30 } },
      select: { cpf: true },
    }),
    prisma.accessToken.findMany({
      select: {
        id: true,
        code: true,
        description: true,
        usedCount: true,
        maxUses: true,
        createdAt: true,
        firstUsedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  // ----- Série diária de conexões -----
  const dayMap = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(last30);
    d.setDate(last30.getDate() + i);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of recent) {
    const k = r.authorizedAt.toISOString().slice(0, 10);
    if (dayMap.has(k)) dayMap.set(k, (dayMap.get(k) ?? 0) + 1);
  }
  const lineData = Array.from(dayMap, ([date, count]) => ({
    date: date.slice(5),
    count,
  }));

  // ----- Buckets de pico -----
  const buckets = [
    { label: "00-04h", value: 0 },
    { label: "04-08h", value: 0 },
    { label: "08-12h", value: 0 },
    { label: "12-16h", value: 0 },
    { label: "16-20h", value: 0 },
    { label: "20-24h", value: 0 },
  ];
  for (const r of recent) {
    const h = r.authorizedAt.getHours();
    buckets[Math.floor(h / 4)].value++;
  }

  // ----- Retenção semanal (novos vs recorrentes) -----
  const seenCpfs = new Set<string>();
  allBefore.forEach((r) => seenCpfs.add(r.cpf));

  const weeks: { period: string; novos: number; recorrentes: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const ws = new Date();
    ws.setDate(ws.getDate() - (w + 1) * 7);
    ws.setHours(0, 0, 0, 0);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 7);
    const period = `${ws.getDate()}/${ws.getMonth() + 1}`;
    const wEntries = recent.filter(
      (r) => r.authorizedAt >= ws && r.authorizedAt < we,
    );
    let novos = 0;
    let recorrentes = 0;
    for (const e of wEntries) {
      if (seenCpfs.has(e.cpf)) recorrentes++;
      else {
        novos++;
        seenCpfs.add(e.cpf);
      }
    }
    weeks.push({ period, novos, recorrentes });
  }

  // ----- 1.1 Tráfego (bytes) -----
  const bytesPerDay = new Map<string, { tx: number; rx: number }>();
  for (const k of dayMap.keys()) bytesPerDay.set(k, { tx: 0, rx: 0 });

  let totalTx = 0;
  let totalRx = 0;
  let sessionsWithBytes = 0;
  const consumerMap = new Map<string, { cpf: string; fullName: string; totalBytes: number; sessions: number }>();

  for (const r of recent) {
    const tx = bigIntToNumber(r.bytesTx);
    const rx = bigIntToNumber(r.bytesRx);
    totalTx += tx;
    totalRx += rx;
    const sum = tx + rx;
    if (sum > 0) sessionsWithBytes++;

    const k = r.authorizedAt.toISOString().slice(0, 10);
    const cell = bytesPerDay.get(k) ?? { tx: 0, rx: 0 };
    cell.tx += tx;
    cell.rx += rx;
    bytesPerDay.set(k, cell);

    const cur = consumerMap.get(r.cpf) ?? {
      cpf: r.cpf,
      fullName: r.fullName,
      totalBytes: 0,
      sessions: 0,
    };
    cur.totalBytes += sum;
    cur.sessions++;
    consumerMap.set(r.cpf, cur);
  }
  const bytesData = Array.from(bytesPerDay, ([date, { tx, rx }]) => ({
    date: date.slice(5),
    tx,
    rx,
  }));
  const avgPerSession = sessionsWithBytes > 0 ? Math.round((totalTx + totalRx) / sessionsWithBytes) : 0;
  const topConsumers = Array.from(consumerMap.values())
    .filter((c) => c.totalBytes > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 10);
  const hasTraffic = totalTx + totalRx > 0;

  // ----- 1.2 Heatmap hora × dia -----
  const heatmap: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );
  for (const r of recent) {
    heatmap[r.authorizedAt.getDay()][r.authorizedAt.getHours()]++;
  }
  const dayLabels = WEEKDAY_KEYS.map((k) => dict.admin[k]);

  // ----- 1.5 Dispositivos -----
  const osMap = new Map<string, number>();
  const browserMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  let uaSamples = 0;
  for (const r of recent) {
    if (!r.userAgent) continue;
    uaSamples++;
    const ua = parseUserAgent(r.userAgent);
    osMap.set(ua.os, (osMap.get(ua.os) ?? 0) + 1);
    browserMap.set(ua.browser, (browserMap.get(ua.browser) ?? 0) + 1);
    const lbl = deviceKindLabel(ua.device as DeviceKind, locale);
    deviceMap.set(lbl, (deviceMap.get(lbl) ?? 0) + 1);
  }
  const osData = entriesToTopN(osMap, 6);
  const browserData = entriesToTopN(browserMap, 6);
  const deviceData = entriesToTopN(deviceMap, 4);

  // ----- 1.6 Fingerprint analytics -----
  const fpToCpfs = new Map<string, Set<string>>();
  const cpfToFps = new Map<string, Set<string>>();
  const fpSessions = new Map<string, number>();
  for (const r of recent) {
    if (!r.fingerprint) continue;
    if (!fpToCpfs.has(r.fingerprint)) fpToCpfs.set(r.fingerprint, new Set());
    fpToCpfs.get(r.fingerprint)!.add(r.cpf);
    if (!cpfToFps.has(r.cpf)) cpfToFps.set(r.cpf, new Set());
    cpfToFps.get(r.cpf)!.add(r.fingerprint);
    fpSessions.set(r.fingerprint, (fpSessions.get(r.fingerprint) ?? 0) + 1);
  }
  const uniqueFp = fpToCpfs.size;
  const cpfsWithFp = cpfToFps.size;
  const avgFpPerCpf =
    cpfsWithFp > 0
      ? Array.from(cpfToFps.values()).reduce((s, set) => s + set.size, 0) / cpfsWithFp
      : 0;
  const suspiciousFp = Array.from(fpToCpfs.entries())
    .filter(([, cpfs]) => cpfs.size > 1)
    .map(([fingerprint, cpfs]) => ({
      fingerprint,
      cpfs: Array.from(cpfs),
      sessions: fpSessions.get(fingerprint) ?? 0,
    }))
    .sort((a, b) => b.cpfs.length - a.cpfs.length || b.sessions - a.sessions)
    .slice(0, 10);

  // ----- 1.7 Tokens enriquecidos -----
  const now = new Date();
  let active = 0,
    expired = 0,
    revoked = 0,
    exhausted = 0;
  const ttfu: number[] = [];
  const utilRates: number[] = [];
  const tokenById = new Map<string, (typeof allTokens)[number]>();

  for (const t of allTokens) {
    tokenById.set(t.id, t);
    if (t.revokedAt) revoked++;
    else if (t.expiresAt.getTime() <= now.getTime()) expired++;
    else if (t.usedCount >= t.maxUses) exhausted++;
    else active++;
    if (t.firstUsedAt) ttfu.push(t.firstUsedAt.getTime() - t.createdAt.getTime());
    if (t.usedCount > 0 && t.maxUses > 0) {
      utilRates.push(Math.min(1, t.usedCount / t.maxUses));
    }
  }
  const avgTtfuMin =
    ttfu.length > 0
      ? Math.round(ttfu.reduce((a, b) => a + b, 0) / ttfu.length / 60_000)
      : 0;
  const avgUtilization =
    utilRates.length > 0
      ? Math.round((utilRates.reduce((a, b) => a + b, 0) / utilRates.length) * 100)
      : 0;

  const tokenBytesMap = new Map<string, number>();
  for (const r of recent) {
    if (!r.tokenId) continue;
    const tx = bigIntToNumber(r.bytesTx);
    const rx = bigIntToNumber(r.bytesRx);
    tokenBytesMap.set(r.tokenId, (tokenBytesMap.get(r.tokenId) ?? 0) + tx + rx);
  }
  const tokenBytesRows = Array.from(tokenBytesMap.entries())
    .map(([id, bytes]) => {
      const tok = tokenById.get(id);
      return tok
        ? { code: tok.code, description: tok.description, totalBytes: bytes }
        : null;
    })
    .filter((x): x is { code: string; description: string | null; totalBytes: number } => x !== null)
    .filter((r) => r.totalBytes > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 10);

  const neverUsedRows = allTokens
    .filter(
      (t) =>
        t.usedCount === 0 &&
        !t.revokedAt &&
        t.createdAt.getTime() <= sevenDaysAgo.getTime() &&
        t.expiresAt.getTime() > now.getTime(),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, 10);

  const topUsage = await prisma.accessToken.findMany({
    where: { usedCount: { gt: 0 } },
    orderBy: { usedCount: "desc" },
    take: 5,
    select: { code: true, description: true, usedCount: true, maxUses: true },
  });

  return {
    total,
    todayCount,
    distinctCpfs,
    lineData,
    buckets,
    weeks,
    bytesData,
    totalTx,
    totalRx,
    avgPerSession,
    topConsumers,
    hasTraffic,
    heatmap,
    dayLabels,
    osData,
    browserData,
    deviceData,
    uaSamples,
    uniqueFp,
    avgFpPerCpf,
    suspiciousFp,
    tokenCounts: { total: allTokens.length, active, expired, revoked, exhausted },
    avgTtfuMin,
    avgUtilization,
    topUsage,
    tokenBytesRows,
    neverUsedRows,
  };
}

export default async function AdminDashboard() {
  const headersList = await headers();
  const locale = getLocale(headersList.get("accept-language"));
  const dict = dictionaries[locale];
  const intl = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";

  const data: DashboardData = await loadDashboard(locale);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{dict.admin.navDashboard}</h1>
        <p className="text-sm text-muted-foreground">{dict.admin.dashDesc}</p>
      </div>

      {/* Resumo */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title={dict.admin.dashTotal} value={data.total.toLocaleString(intl)} />
        <StatCard title={dict.admin.dashUnique} value={data.distinctCpfs.toLocaleString(intl)} />
        <StatCard title={dict.admin.dashToday} value={data.todayCount.toLocaleString(intl)} />
      </div>

      {/* Gráficos principais */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{dict.admin.dash30Days}</CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectionsLineChart data={data.lineData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{dict.admin.dashPeak}</CardTitle>
          </CardHeader>
          <CardContent>
            <PeakHoursPieChart data={data.buckets} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{dict.admin.dashRetention}</CardTitle>
          </CardHeader>
          <CardContent>
            <RetentionBarChart data={data.weeks} />
          </CardContent>
        </Card>
      </div>

      {/* 1.2 Heatmap hora × dia */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{dict.admin.dashHeatmapTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.admin.dashHeatmapDesc}</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <HourlyHeatmap
              cells={data.heatmap}
              dayLabels={data.dayLabels}
              cellTitleFmt={(count, day, hour) =>
                dict.admin.dashHeatmapCellTitle
                  .replace("{day}", day)
                  .replace("{hour}", hour.toString().padStart(2, "0"))
                  .replace("{count}", count.toString())
              }
            />
          </CardContent>
        </Card>
      </section>

      {/* 1.1 Painel de Tráfego */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{dict.admin.dashTrafficTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.admin.dashTrafficDesc}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard title={dict.admin.dashBytesRx} value={formatBytes(data.totalRx, locale)} />
          <StatCard title={dict.admin.dashBytesTx} value={formatBytes(data.totalTx, locale)} />
          <StatCard title={dict.admin.dashBytesAvg} value={formatBytes(data.avgPerSession, locale)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{dict.admin.dashBytesPerDay}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.hasTraffic ? (
                <BytesAreaChart
                  data={data.bytesData}
                  txLabel={dict.admin.dashBytesTxShort}
                  rxLabel={dict.admin.dashBytesRxShort}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{dict.admin.dashNoTraffic}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{dict.admin.dashTopConsumers}</CardTitle>
              <p className="text-xs text-muted-foreground">{dict.admin.dashTopConsumersDesc}</p>
            </CardHeader>
            <CardContent>
              {data.topConsumers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{dict.admin.dashNoTraffic}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.topConsumers.map((c) => (
                    <li
                      key={c.cpf}
                      className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.fullName}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{maskCpf(c.cpf)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatBytes(c.totalBytes, locale)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.sessions} {dict.admin.dashTopConsumerColSessions.toLowerCase()}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 1.5 Dispositivos */}
      {data.uaSamples > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{dict.admin.dashDevicesTitle}</h2>
            <p className="text-sm text-muted-foreground">{dict.admin.dashDevicesDesc}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashDeviceOS}</CardTitle>
              </CardHeader>
              <CardContent>
                <DeviceBreakdownPie data={data.osData} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashDeviceBrowser}</CardTitle>
              </CardHeader>
              <CardContent>
                <DeviceBreakdownPie data={data.browserData} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashDeviceType}</CardTitle>
              </CardHeader>
              <CardContent>
                <DeviceBreakdownPie data={data.deviceData} />
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* 1.6 Fingerprint analytics */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{dict.admin.dashFingerprintTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.admin.dashFingerprintDesc}</p>
        </div>

        {data.uniqueFp === 0 ? (
          <Card>
            <CardContent className="py-6">
              <p className="text-sm text-muted-foreground">{dict.admin.dashFingerprintNoData}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                title={dict.admin.dashFingerprintUnique}
                value={data.uniqueFp.toLocaleString(intl)}
              />
              <StatCard
                title={dict.admin.dashFingerprintAvg}
                value={data.avgFpPerCpf.toFixed(2)}
              />
              <StatCard
                title={dict.admin.dashFingerprintSuspicious}
                value={data.suspiciousFp.length.toString()}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {dict.admin.dashFingerprintSuspicious}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.suspiciousFp.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {dict.admin.dashFingerprintNoSuspicious}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="py-2 pr-2 font-medium">
                            {dict.admin.dashFingerprintColFp}
                          </th>
                          <th className="py-2 pr-2 font-medium">
                            {dict.admin.dashFingerprintColCpfs}
                          </th>
                          <th className="py-2 pr-2 font-medium text-right">
                            {dict.admin.dashFingerprintColSessions}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.suspiciousFp.map((row) => (
                          <tr key={row.fingerprint} className="border-b border-border/40 last:border-0">
                            <td className="py-2 pr-2 font-mono text-xs">
                              {row.fingerprint.slice(0, 16)}…
                            </td>
                            <td className="py-2 pr-2">
                              <div className="flex flex-wrap gap-1">
                                {row.cpfs.map((c) => (
                                  <span
                                    key={c}
                                    className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
                                  >
                                    {maskCpf(c)}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-2 pr-2 text-right font-medium">{row.sessions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </section>

      {/* Tokens (com novas métricas 1.7) */}
      {data.tokenCounts.total > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{dict.admin.dashTokensTitle}</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard title={dict.admin.statusActive} value={String(data.tokenCounts.active)} />
            <StatCard title={dict.admin.statusExpired} value={String(data.tokenCounts.expired)} />
            <StatCard title={dict.admin.statusRevoked} value={String(data.tokenCounts.revoked)} />
            <StatCard title={dict.admin.statusExhausted} value={String(data.tokenCounts.exhausted)} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashTokenAvgTtfu}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">
                  {data.avgTtfuMin}
                  <span className="ml-1 text-sm text-muted-foreground">min</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{dict.admin.dashTokenAvgTtfuHint}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashTokenUtilization}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">
                  {data.avgUtilization}
                  <span className="ml-1 text-sm text-muted-foreground">%</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dict.admin.dashTokenUtilizationHint}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashTokenTopUsage}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.topUsage.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{dict.admin.noTokens}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.topUsage.map((t) => (
                      <li
                        key={t.code}
                        className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-mono">{t.code}</span>
                          {t.description && (
                            <span className="ml-2 text-muted-foreground">{t.description}</span>
                          )}
                        </div>
                        <span className="font-medium">
                          {t.usedCount}/{t.maxUses}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashTokenBytesTitle}</CardTitle>
                <p className="text-xs text-muted-foreground">{dict.admin.dashTokenBytesDesc}</p>
              </CardHeader>
              <CardContent>
                {data.tokenBytesRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{dict.admin.dashTokenNoBytes}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="py-2 pr-2 font-medium">{dict.admin.dashTokenColCode}</th>
                          <th className="py-2 pr-2 font-medium">
                            {dict.admin.dashTokenColDescription}
                          </th>
                          <th className="py-2 pr-2 text-right font-medium">
                            {dict.admin.dashTokenColBytes}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.tokenBytesRows.map((r) => (
                          <tr key={r.code} className="border-b border-border/40 last:border-0">
                            <td className="py-2 pr-2 font-mono">{r.code}</td>
                            <td className="py-2 pr-2 text-muted-foreground">{r.description ?? "—"}</td>
                            <td className="py-2 pr-2 text-right font-medium">
                              {formatBytes(r.totalBytes, locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{dict.admin.dashTokenNeverUsedTitle}</CardTitle>
                <p className="text-xs text-muted-foreground">{dict.admin.dashTokenNeverUsedDesc}</p>
              </CardHeader>
              <CardContent>
                {data.neverUsedRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{dict.admin.dashTokenAllUsed}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="py-2 pr-2 font-medium">{dict.admin.dashTokenColCode}</th>
                          <th className="py-2 pr-2 font-medium">
                            {dict.admin.dashTokenColDescription}
                          </th>
                          <th className="py-2 pr-2 text-right font-medium">
                            {dict.admin.dashTokenColCreated}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.neverUsedRows.map((t) => (
                          <tr key={t.id} className="border-b border-border/40 last:border-0">
                            <td className="py-2 pr-2 font-mono">{t.code}</td>
                            <td className="py-2 pr-2 text-muted-foreground">{t.description ?? "—"}</td>
                            <td className="py-2 pr-2 text-right text-xs text-muted-foreground">
                              {t.createdAt.toLocaleDateString(intl)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </div>
  );
}
