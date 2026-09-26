import { redirect } from "next/navigation";

/**
 * A controladora UniFi redireciona o cliente para:
 *   http://<portal-ip>/guest/s/<site>/?id=<MAC>&ap=<AP>&ssid=<SSID>&t=<token>&url=<originalUrl>
 *
 * Esta rota captura esse padrão e repassa todos os parâmetros para /portal,
 * incluindo o `<site>` do caminho como `?site=` — sem isso, instalações
 * multi-site autorizavam sempre no UNIFI_SITE padrão.
 */
export default async function UniFiGuestRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { site } = await params;
  const sp = await searchParams;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value.length > 0) query.set(key, value[0]);
  }
  const siteName = decodeURIComponent(site ?? "").trim();
  if (!query.has("site") && /^[A-Za-z0-9_-]{1,64}$/.test(siteName)) {
    query.set("site", siteName);
  }

  const qs = query.toString();
  redirect(`/portal${qs ? `?${qs}` : ""}`);
}
