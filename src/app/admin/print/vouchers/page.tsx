import { headers } from "next/headers";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { getSystemSettings, resolveBranding } from "@/lib/settings";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { portalBaseUrl, tokenDeepLink } from "@/lib/portalUrl";
import { PrintToolbar } from "./PrintToolbar";

export const dynamic = "force-dynamic";

const MAX_VOUCHERS = 500;

/**
 * Folha de vouchers para imprimir (A4, 8 por página). Protegida pelo proxy
 * (/admin/*). Aceita `?batch=<batchId>` ou `?ids=a,b,c` e `?ssid=` opcional.
 */
export default async function PrintVouchersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const batch = typeof sp.batch === "string" ? sp.batch : null;
  const ids = typeof sp.ids === "string" ? sp.ids.split(",").filter(Boolean).slice(0, MAX_VOUCHERS) : [];
  const ssid = typeof sp.ssid === "string" ? sp.ssid.slice(0, 64) : "";

  const h = await headers();
  const dict = dictionaries[getLocale(h.get("accept-language"))];
  const t = dict.admin;
  const intl = dict === dictionaries.en ? "en-US" : dict === dictionaries.es ? "es-ES" : "pt-BR";

  const tokens =
    batch || ids.length
      ? await prisma.accessToken.findMany({
          where: batch ? { batchId: batch } : { id: { in: ids } },
          orderBy: { createdAt: "asc" },
          take: MAX_VOUCHERS,
        })
      : [];

  const settings = await getSystemSettings();
  const branding = await resolveBranding(settings, tokens[0]?.site);
  const base = portalBaseUrl(h);

  const cards = await Promise.all(
    tokens.map(async (tk) => ({
      tk,
      qr: await QRCode.toString(tokenDeepLink(base, tk), { type: "svg", errorCorrectionLevel: "M", margin: 0 }),
    })),
  );

  const duration = (min: number) =>
    min % 1440 === 0 ? `${min / 1440} d` : min % 60 === 0 ? `${min / 60} h` : `${min} min`;

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .voucher { break-inside: avoid; } }`}</style>
      <PrintToolbar ssid={ssid} count={cards.length} dict={dict} />
      {cards.length === 0 ? (
        <p className="p-10 text-center text-muted-foreground">{t.voucherNone}</p>
      ) : (
        <div className="mx-auto grid max-w-[190mm] grid-cols-2 gap-3 p-4 print:p-0">
          {cards.map(({ tk, qr }) => (
            <div key={tk.id} className="voucher flex gap-3 rounded-lg border-2 border-dashed border-slate-300 bg-white p-4">
              <div
                className="h-28 w-28 shrink-0 [&>svg]:h-full [&>svg]:w-full"
                // SVG gerado localmente pela lib qrcode a partir do deep-link.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="truncate text-sm font-bold">{branding.brandName}</div>
                {ssid && (
                  <div className="text-xs">
                    {t.voucherNetwork}: <span className="font-semibold">{ssid}</span>
                  </div>
                )}
                <div className="font-mono text-lg font-bold tracking-wider">{tk.code}</div>
                <div className="text-xs text-slate-600">
                  {t.voucherDuration}: {duration(tk.durationMin)}
                  {tk.maxUses > 1 ? ` · ${tk.maxUses}×` : ""}
                </div>
                <div className="text-xs text-slate-600">
                  {t.voucherValidUntil}: {tk.expiresAt.toLocaleString(intl, { dateStyle: "short", timeStyle: "short" })}
                </div>
                <div className="text-[10px] leading-tight text-slate-500">{t.voucherScanHint}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
