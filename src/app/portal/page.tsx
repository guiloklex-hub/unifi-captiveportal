import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/rateLimit";
import { findClientMacByIp } from "@/lib/unifi";
import { logger } from "@/lib/logger";
import { PortalForm } from "@/components/portal/PortalForm";
import { getSystemSettings, resolveBranding } from "@/lib/settings";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { findReturningGuest } from "@/lib/portal/returning";
import { findAllowRule } from "@/lib/portal/accessRules";
import { availableProviders, peekSocialTicket } from "@/lib/portal/oauth";
import { currentTermsHash } from "@/lib/privacy";
import { contrastForeground } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MAC_RE = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i;
const SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOOKUP_TIMEOUT_MS = 4_000;

/**
 * Sem `?id=<mac>` (portal aberto direto, ex.: QR code de token lido pela câmera),
 * tenta descobrir o MAC pelo IP do cliente na controladora. Requer proxy reverso
 * que informe o IP real (X-Real-IP/X-Forwarded-For). Desative com
 * PORTAL_MAC_LOOKUP=false.
 */
async function macFromClientIp(h: Headers, site: string | null): Promise<string | null> {
  if (process.env.PORTAL_MAC_LOOKUP === "false") return null;
  const ip = clientIp(h);
  if (ip === "unknown") return null;
  try {
    return await Promise.race([
      findClientMacByIp(ip, site),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)),
    ]);
  } catch (err) {
    logger.warn({ ip, err: (err as Error).message }, "portal: MAC lookup by IP failed");
    return null;
  }
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const mac = param("id") || param("mac");
  const site = SITE_RE.test(param("site")) ? param("site") : null;
  const preview = param("preview") === "1";

  const headersList = await headers();

  if (!MAC_RE.test(mac) && !preview) {
    const found = await macFromClientIp(headersList, site);
    if (found) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
      qs.set("id", found);
      redirect(`/portal?${qs.toString()}`);
    }
  }

  const settings = await getSystemSettings();
  const branding = await resolveBranding(settings, site);

  const locale = getLocale(headersList.get("accept-language"));
  const dict = dictionaries[locale];

  const socialTicket = param("social");
  const social =
    socialTicket && MAC_RE.test(mac)
      ? await peekSocialTicket(socialTicket, mac)
          .then((s) => (s ? { ...s, ticket: socialTicket } : null))
          .catch(() => null)
      : null;

  const allowed = !preview && !social && MAC_RE.test(mac) ? await findAllowRule(mac).catch(() => null) : null;
  const returning = allowed
    ? { firstName: "" }
    : !preview && !social && MAC_RE.test(mac)
      ? await findReturningGuest(mac, settings, await currentTermsHash(settings, site))
          .then((r) => (r ? { firstName: r.firstName } : null))
          .catch(() => null)
      : null;

  const bgStyle = branding.backgroundUrl
    ? { backgroundImage: `url("${branding.backgroundUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : {};

  return (
    <main
      className="relative flex min-h-dvh flex-col items-center justify-center bg-slate-50 p-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]"
      style={bgStyle}
    >
      {branding.primaryColor !== settings.primaryColor && (
        // Cor do site sobrescreve a global (validada como hex em resolveBranding).
        <style>{`:root:root:root { --color-primary: ${branding.primaryColor}; --color-primary-foreground: ${contrastForeground(branding.primaryColor)}; --color-ring: ${branding.primaryColor}; }`}</style>
      )}
      {branding.backgroundUrl && <div className="absolute inset-0 bg-black/30 backdrop-blur-xs" />}
      <div className="relative z-10 w-full max-w-md">
        <Suspense fallback={<div>{dict.admin.loading}</div>}>
          <PortalForm
            branding={branding}
            config={{
              requireToken: settings.requireToken,
              fieldName: settings.fieldName,
              fieldEmail: settings.fieldEmail,
              fieldPhone: settings.fieldPhone,
              fieldDocument: settings.fieldDocument,
              allowForeignDocument: settings.allowForeignDocument,
            }}
            dict={dict}
            returning={returning}
            preview={preview}
            suggestForeign={locale !== "pt"}
            verificationMode={settings.verificationMode}
            socialProviders={availableProviders(settings)}
            social={social}
            socialError={Boolean(param("socialError"))}
            marketing={{ enabled: settings.marketingConsentMode === "optional", text: settings.marketingConsentText }}
          />
        </Suspense>
      </div>
    </main>
  );
}
