"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type Row = { id: number; at: string; actor: string; action: string; target: string | null; details: string | null; ip: string | null };

const PAGE_SIZE = 50;

export default function AuditPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [filters, setFilters] = useState({ actor: "", action: "", q: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  const t = dict.admin;

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v.trim()) sp.set(k, v.trim());
      for (const [k, v] of Object.entries(extra)) sp.set(k, v);
      return sp.toString();
    },
    [filters],
  );

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/audit?${query({ page: String(page), pageSize: String(PAGE_SIZE) })}`);
    setData(await res.json());
  }, [query, page]);

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.navAudit}</h1>
          <p className="text-sm text-muted-foreground">{t.auditDesc}</p>
        </div>
        <Button asChild variant="outline">
          <a href={`/api/admin/audit?${query({ format: "csv" })}`}>{t.exportCsvBtn}</a>
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          aria-label={t.auditActor}
          placeholder={t.auditActor}
          value={filters.actor}
          onChange={(e) => {
            setPage(1);
            setFilters({ ...filters, actor: e.target.value });
          }}
        />
        <Input
          aria-label={t.auditAction}
          placeholder={t.auditActionPlaceholder}
          value={filters.action}
          onChange={(e) => {
            setPage(1);
            setFilters({ ...filters, action: e.target.value });
          }}
        />
        <Input
          aria-label={t.auditSearch}
          placeholder={t.auditSearch}
          value={filters.q}
          onChange={(e) => {
            setPage(1);
            setFilters({ ...filters, q: e.target.value });
          }}
        />
      </div>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {!data ? (
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          ) : data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noRecords}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">{t.auditWhen}</th>
                  <th className="py-2 pr-3">{t.auditActor}</th>
                  <th className="py-2 pr-3">{t.auditAction}</th>
                  <th className="py-2 pr-3">{t.auditTarget}</th>
                  <th className="py-2 pr-3">{t.auditDetails}</th>
                  <th className="py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 text-xs">{new Date(r.at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{r.actor}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.action}</td>
                    <td className="py-2 pr-3 text-xs">{r.target ?? "—"}</td>
                    <td className="max-w-md break-words py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                      {r.details ?? ""}
                    </td>
                    <td className="py-2 text-xs">{r.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 text-sm">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ←
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          →
        </Button>
      </div>
    </div>
  );
}
