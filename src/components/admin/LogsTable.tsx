"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { maskCPF, maskPhoneBR } from "@/lib/masks";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type LogRow = {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  cpf: string;
  macAddress: string;
  authorizedAt: string;
};

export function LogsTable({ dict }: { dict: Dictionary }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [data, setData] = useState<{ rows: LogRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const buildParams = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({
      ...(q && { q }),
      ...(from && { from }),
      ...(to && { to }),
      page: String(page),
      pageSize: String(pageSize),
      ...extra,
    });
    return p.toString();
  };

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/logs?${buildParams()}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">{dict.admin.searchLabel}</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={dict.admin.searchPlaceholder} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{dict.admin.fromLabel}</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{dict.admin.toLabel}</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            onClick={() => {
              setPage(1);
              load();
            }}
          >
            {dict.admin.filterBtn}
          </Button>
          <Button
            variant="outline"
            asChild
          >
            <a href={`/api/admin/logs?${buildParams({ format: "csv" })}`} download>
              {dict.admin.exportCsvBtn}
            </a>
          </Button>
        </div>

        {/* Desktop View: Tabela clássica */}
        <div className="hidden md:block rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{dict.admin.tableId}</TableHead>
                <TableHead>{dict.admin.tableName}</TableHead>
                <TableHead>{dict.admin.tableCpf}</TableHead>
                <TableHead>{dict.admin.tableEmail}</TableHead>
                <TableHead>{dict.admin.tablePhone}</TableHead>
                <TableHead>{dict.admin.tableMac}</TableHead>
                <TableHead>{dict.admin.tableDate}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {dict.admin.loading}
                  </TableCell>
                </TableRow>
              ) : data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {dict.admin.noRecords}
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.id}</TableCell>
                    <TableCell className="font-medium">{r.fullName}</TableCell>
                    <TableCell>{maskCPF(r.cpf)}</TableCell>
                    <TableCell>{r.email}</TableCell>
                    <TableCell>{maskPhoneBR(r.phone)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.macAddress}</TableCell>
                    <TableCell>{new Date(r.authorizedAt).toLocaleString("pt-BR")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile View: Cards */}
        <div className="md:hidden flex flex-col gap-3">
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground border rounded-md">
              {dict.admin.loading}
            </div>
          ) : data.rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground border rounded-md">
              {dict.admin.noRecords}
            </div>
          ) : (
            data.rows.map((r) => (
              <div key={r.id} className="border rounded-md p-4 space-y-3 bg-white shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-slate-900">{r.fullName}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </div>
                  <div className="text-[10px] text-slate-600 bg-slate-100 px-2 py-1 rounded whitespace-nowrap ml-2">
                    {new Date(r.authorizedAt).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
                  <div>CPF: <span className="font-medium text-slate-900">{maskCPF(r.cpf)}</span></div>
                  <div>Tel: <span className="font-medium text-slate-900">{maskPhoneBR(r.phone)}</span></div>
                  <div className="w-full font-mono text-[10px] mt-1 text-slate-500">MAC: {r.macAddress}</div>
                </div>
              </div>
            ))
          )}
        </div>


        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.total} {dict.admin.recordsCount} — {dict.admin.pageCount} {page} {dict.admin.ofCount} {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {dict.admin.prevBtn}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {dict.admin.nextBtn}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
