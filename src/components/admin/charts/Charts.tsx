"use client";

import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  AreaChart,
  Area,
} from "recharts";

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#84cc16"];

function formatBytesShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function ConnectionsLineChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PeakHoursPieChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RetentionBarChart({
  data,
}: {
  data: { period: string; novos: number; recorrentes: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="period" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="novos" fill="#2563eb" radius={[6, 6, 0, 0]} />
        <Bar dataKey="recorrentes" fill="#16a34a" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BytesAreaChart({
  data,
  txLabel,
  rxLabel,
}: {
  data: { date: string; tx: number; rx: number }[];
  txLabel: string;
  rxLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="rxFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#16a34a" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatBytesShort(Number(v))} width={70} />
        <Tooltip formatter={(v: number, name) => [formatBytesShort(Number(v)), name === "rx" ? rxLabel : txLabel]} />
        <Legend formatter={(v) => (v === "rx" ? rxLabel : txLabel)} />
        <Area type="monotone" dataKey="rx" stroke="#2563eb" fill="url(#rxFill)" strokeWidth={2} />
        <Area type="monotone" dataKey="tx" stroke="#16a34a" fill="url(#txFill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DeviceBreakdownPie({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        —
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={45}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HourlyHeatmap({
  cells,
  dayLabels,
  cellTitleFmt,
}: {
  cells: number[][]; // [day 0..6][hour 0..23]
  dayLabels: string[];
  cellTitleFmt: (count: number, day: string, hour: number) => string;
}) {
  let max = 0;
  for (const row of cells) for (const v of row) if (v > max) max = v;

  function bg(v: number) {
    if (v === 0) return "#f1f5f9";
    const intensity = max === 0 ? 0 : v / max;
    const alpha = 0.15 + intensity * 0.85;
    return `rgba(37, 99, 235, ${alpha.toFixed(2)})`;
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid" style={{ gridTemplateColumns: "44px repeat(24, 1fr)", gap: "2px" }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[10px] text-muted-foreground">
              {h.toString().padStart(2, "0")}
            </div>
          ))}
          {cells.map((row, d) => (
            <div key={d} className="contents">
              <div className="pr-2 text-right text-[11px] text-muted-foreground self-center">
                {dayLabels[d]}
              </div>
              {row.map((v, h) => (
                <div
                  key={h}
                  className="aspect-square rounded-[3px]"
                  style={{ background: bg(v), minHeight: 18 }}
                  title={cellTitleFmt(v, dayLabels[d], h)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
