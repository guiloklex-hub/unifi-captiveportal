import { listActiveGuests } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RevokeButton } from "@/components/admin/RevokeButton";
import { headers } from "next/headers";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { ActivityDialog } from "@/components/admin/ActivityDialog";

export const dynamic = "force-dynamic";

function formatBytes(n?: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export default async function SessionsPage() {
  let guests: Awaited<ReturnType<typeof listActiveGuests>> = [];
  let error: string | null = null;
  try {
    const allGuests = await listActiveGuests();
    // Filtra para exibir apenas quem está efetivamente autorizado no momento
    // E garante unicidade por MAC para evitar glitches de chaves duplicadas na tabela
    const seen = new Set<string>();
    guests = allGuests.filter((g) => {
      const mac = g.mac.toLowerCase();
      // Em algumas versões da UniFi, o campo authorized pode vir ausente (undefined)
      // Portanto, só ocultamos se for explicitamente false (não autorizado).
      if (g.authorized === false || seen.has(mac)) return false;
      seen.add(mac);
      return true;
    });
  } catch (err) {
    // Wait for dict extraction later, or use a default error message
    error = err instanceof Error ? err.message : "error";
  }

  const headersList = await headers();
  const locale = getLocale(headersList.get("accept-language"));
  const dict = dictionaries[locale];
  
  if (error === "error") error = dict.admin.unifiError;

  const macs = guests.map((g) => g.mac.toLowerCase());
  const registrations = await prisma.guestRegistration.findMany({
    where: { macAddress: { in: macs } },
    orderBy: { authorizedAt: "desc" },
  });

  // Usamos um Map para busca rápida. Como os registros estão em ordem DESC (mais recentes primeiro),
  // iteramos normalmente e só adicionamos se ainda não existir no Map, garantindo o mais recente.
  const byMac = new Map<string, (typeof registrations)[0]>();
  for (const r of registrations) {
    const mac = r.macAddress.toLowerCase();
    if (!byMac.has(mac)) {
      byMac.set(mac, r);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{dict.admin.sessionsTitle}</h1>
        <p className="text-sm text-muted-foreground">
          {dict.admin.sessionsDesc}
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{guests.length} {dict.admin.sessionsCount}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{dict.admin.tableVisitor}</TableHead>
                <TableHead>{dict.admin.tableMac}</TableHead>
                <TableHead>{dict.admin.tableSsid}</TableHead>
                <TableHead>↓ RX</TableHead>
                <TableHead>↑ TX</TableHead>
                <TableHead>{dict.admin.tableStart}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guests.map((g) => {
                const reg = byMac.get(g.mac.toLowerCase());
                return (
                  <TableRow key={g.mac}>
                    <TableCell className="font-medium">
                      {reg?.fullName ?? <span className="text-muted-foreground">{dict.admin.unknown}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{g.mac}</TableCell>
                    <TableCell>{g.essid ?? "-"}</TableCell>
                    <TableCell>{formatBytes(g.rx_bytes)}</TableCell>
                    <TableCell>{formatBytes(g.tx_bytes)}</TableCell>
                    <TableCell>
                      {g.start ? new Date(g.start * 1000).toLocaleString(locale === "en" ? "en-US" : "pt-BR") : "-"}
                    </TableCell>
                    <TableCell className="text-right flex items-center justify-end gap-1">
                      {g.ip && (
                        <ActivityDialog 
                          ip={g.ip} 
                          name={reg?.fullName || g.hostname || g.mac} 
                          dict={dict} 
                        />
                      )}
                      <RevokeButton mac={g.mac} dict={dict} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {guests.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {dict.admin.noActiveSessions}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
