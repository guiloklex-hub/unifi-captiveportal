import { headers } from "next/headers";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { LogsTable } from "@/components/admin/LogsTable";
import { SiteFilter } from "@/components/admin/SiteFilter";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const headersList = await headers();
  const locale = getLocale(headersList.get("accept-language"));
  const dict = dictionaries[locale];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{dict.admin.logsTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {dict.admin.logsDesc}
          </p>
        </div>
        <SiteFilter dict={dict} />
      </div>
      <LogsTable dict={dict} />
    </div>
  );
}
