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
      // Apenas exibe se estiver explicitamente autorizado e se for o primeiro registro desse MAC
      if (g.authorized !== true || seen.has(mac)) return false;
      seen.add(mac);
      return true;
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "Erro ao consultar UniFi";
  }

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
        <h1 className="text-2xl font-bold">Sessões ativas</h1>
        <p className="text-sm text-muted-foreground">
          Cruzamento entre <code>/stat/guest</code> da UniFi e os registros locais.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{guests.length} sessões</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visitante</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>SSID</TableHead>
                <TableHead>↓ RX</TableHead>
                <TableHead>↑ TX</TableHead>
                <TableHead>Início</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guests.map((g) => {
                const reg = byMac.get(g.mac.toLowerCase());
                return (
                  <TableRow key={g.mac}>
                    <TableCell className="font-medium">
                      {reg?.fullName ?? <span className="text-muted-foreground">desconhecido</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{g.mac}</TableCell>
                    <TableCell>{g.essid ?? "-"}</TableCell>
                    <TableCell>{formatBytes(g.rx_bytes)}</TableCell>
                    <TableCell>{formatBytes(g.tx_bytes)}</TableCell>
                    <TableCell>
                      {g.start ? new Date(g.start * 1000).toLocaleString("pt-BR") : "-"}
                    </TableCell>
                    <TableCell>
                      <RevokeButton mac={g.mac} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {guests.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Nenhuma sessão ativa
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
