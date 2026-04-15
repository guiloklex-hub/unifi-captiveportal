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

type LogRow = {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  cpf: string;
  macAddress: string;
  authorizedAt: string;
};

export function LogsTable() {
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
            <label className="text-xs text-muted-foreground">Busca (nome ou CPF)</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite..." />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            onClick={() => {
              setPage(1);
              load();
            }}
          >
            Filtrar
          </Button>
          <Button
            variant="outline"
            asChild
          >
            <a href={`/api/admin/logs?${buildParams({ format: "csv" })}`} download>
              Exportar CSV
            </a>
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Data/Hora</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Nenhum registro
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

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.total} registro(s) — página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
