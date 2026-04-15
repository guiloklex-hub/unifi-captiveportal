import { LogsTable } from "@/components/admin/LogsTable";

export const dynamic = "force-dynamic";

export default function LogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Logs de conexão</h1>
        <p className="text-sm text-muted-foreground">
          Todos os visitantes que autenticaram no portal Guest.
        </p>
      </div>
      <LogsTable />
    </div>
  );
}
