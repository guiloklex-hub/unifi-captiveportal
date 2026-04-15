import { redirect } from "next/navigation";

/**
 * A controladora UniFi redireciona o cliente para:
 *   http://<portal-ip>/guest/s/<site>/?id=<MAC>&ap=<AP>&ssid=<SSID>&t=<token>&url=<originalUrl>
 *
 * Esta rota captura esse padrão e repassa todos os parâmetros para /portal.
 */
export default async function UniFiGuestRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  await params; // resolve dynamic segment (Next.js 15)
  const sp = await searchParams;

  const query = new URLSearchParams(sp).toString();
  redirect(`/portal${query ? `?${query}` : ""}`);
}
