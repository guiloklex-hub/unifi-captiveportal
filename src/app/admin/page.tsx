import { headers } from "next/headers";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
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
} from "@/components/admin/charts/Charts";

export const dynamic = "force-dynamic";

async function loadStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const last30 = new Date();
  last30.setDate(last30.getDate() - 29);
  last30.setHours(0, 0, 0, 0);

  const [total, todayCount, distinctCpfs, recent] = await Promise.all([
    prisma.guestRegistration.count(),
    prisma.guestRegistration.count({ where: { authorizedAt: { gte: startOfToday } } }),
    prisma.guestRegistration
      .findMany({ select: { cpf: true }, distinct: ["cpf"] })
      .then((r) => r.length),
    prisma.guestRegistration.findMany({
      where: { authorizedAt: { gte: last30 } },
      select: { authorizedAt: true, cpf: true },
      orderBy: { authorizedAt: "asc" },
    }),
  ]);

  // Série diária
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

  // Pico de horários (buckets de 4h)
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

  // Retenção: novos vs recorrentes nos últimos 4 períodos semanais
  const seenCpfs = new Set<string>();
  const allBefore = await prisma.guestRegistration.findMany({
    where: { authorizedAt: { lt: last30 } },
    select: { cpf: true },
  });
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

  return { total, todayCount, distinctCpfs, lineData, buckets, weeks };
}

export default async function AdminDashboard() {
  const headersList = await headers();
  const locale = getLocale(headersList.get("accept-language"));
  const dict = dictionaries[locale];

  const { total, todayCount, distinctCpfs, lineData, buckets, weeks } = await loadStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{dict.admin.navDashboard}</h1>
        <p className="text-sm text-muted-foreground">{dict.admin.dashDesc}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title={dict.admin.dashTotal} value={total.toLocaleString(locale === "en" ? "en-US" : "pt-BR")} />
        <StatCard title={dict.admin.dashUnique} value={distinctCpfs.toLocaleString(locale === "en" ? "en-US" : "pt-BR")} />
        <StatCard title={dict.admin.dashToday} value={todayCount.toLocaleString(locale === "en" ? "en-US" : "pt-BR")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{dict.admin.dash30Days}</CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectionsLineChart data={lineData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{dict.admin.dashPeak}</CardTitle>
          </CardHeader>
          <CardContent>
            <PeakHoursPieChart data={buckets} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{dict.admin.dashRetention}</CardTitle>
          </CardHeader>
          <CardContent>
            <RetentionBarChart data={weeks} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
