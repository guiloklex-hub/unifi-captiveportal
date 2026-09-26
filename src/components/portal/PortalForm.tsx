"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeFingerprint } from "@/lib/fingerprint";
import Image from "next/image";
import { TermsModal } from "./TermsModal";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getGuestRegistrationSchema,
  type GuestRegistrationFormValues,
  type GuestRegistrationInput,
  type PortalFormConfig,
} from "@/lib/validators";
import { maskCPF, maskPhoneBR } from "@/lib/masks";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Branding, FieldMode, VerificationMode } from "@/lib/settings";

type Provider = "google" | "microsoft";
const PROVIDER_LABEL: Record<Provider, string> = { google: "Google", microsoft: "Microsoft" };

type OtpState = { challengeId: string; channel: "email" | "sms"; destination: string; preAuthMinutes: number };
const RESEND_SECONDS = 45;

function formatTokenCode(raw: string): string {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += 4) parts.push(cleaned.slice(i, i + 4));
  return parts.join("-");
}

export type PortalFormProps = {
  branding: Branding;
  config: Required<PortalFormConfig>;
  dict: Dictionary;
  /** Dispositivo reconhecido ("lembrar dispositivo"); `firstName` pode ser vazio. */
  returning: { firstName: string } | null;
  /** Pré-visualização aberta pelo admin: nada é enviado. */
  preview: boolean;
  /** Idioma do navegador não é português → sugere o fluxo de estrangeiro. */
  suggestForeign: boolean;
  verificationMode: VerificationMode;
  socialProviders: Provider[];
  /** Identidade retornada pelo login social (ticket de uso único). */
  social: { provider: Provider; name: string; email: string; ticket: string } | null;
  socialError: boolean;
  /** Checkbox opcional de marketing (LGPD: separado do aceite dos termos). */
  marketing: { enabled: boolean; text: string | null };
};

export function PortalForm({
  branding,
  config,
  dict,
  returning,
  preview,
  suggestForeign,
  verificationMode,
  socialProviders,
  social,
  socialError,
  marketing,
}: PortalFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showReturning, setShowReturning] = useState(Boolean(returning));
  const [reconnecting, setReconnecting] = useState(false);
  const [otp, setOtp] = useState<OtpState | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const lastValues = useRef<GuestRegistrationInput | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Parâmetros injetados pela controladora UniFi
  const unifiCtx = useMemo(
    () => ({
      mac: params.get("id") ?? params.get("mac") ?? "",
      apMac: params.get("ap") ?? null,
      ssid: params.get("ssid") ?? null,
      site: params.get("site") ?? null,
      originalUrl: params.get("url") ?? null,
    }),
    [params],
  );

  const fingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    computeFingerprint().then((fp) => {
      if (!cancelled) fingerprintRef.current = fp;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GuestRegistrationFormValues, unknown, GuestRegistrationInput>({
    resolver: zodResolver(getGuestRegistrationSchema(dict.validation, config)),
    defaultValues: {
      fullName: social?.name ?? "",
      email: social?.email ?? "",
      phone: "",
      cpf: "",
      document: "",
      documentType: config.allowForeignDocument && suggestForeign ? "passport" : "cpf",
      token: formatTokenCode(params.get("token") ?? ""),
      acceptTerms: false as unknown as true,
      marketingConsent: false,
      ...unifiCtx,
    },
  });

  const cpf = watch("cpf");
  const phone = watch("phone");
  const token = watch("token");
  const foreign = watch("documentType") === "passport";

  const goToSuccess = (data: { id?: number | null; redirect?: string | null }) => {
    const target = data?.redirect || unifiCtx.originalUrl || "";
    const id = data?.id ? `&id=${data.id}` : "";
    router.push(`/portal/success?${target ? `url=${encodeURIComponent(target)}` : ""}${id}`);
  };

  const postJson = (url: string, payload: unknown) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

  const startOtp = async (values: GuestRegistrationInput) => {
    lastValues.current = values;
    const res = await postJson("/api/portal/otp/start", { ...values, fingerprint: fingerprintRef.current });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (typeof data?.retryAfter === "number") setResendIn(data.retryAfter);
      setServerError(data?.error ?? dict.portal.networkError);
      return;
    }
    setOtp(data as OtpState);
    setOtpCode("");
    setResendIn(RESEND_SECONDS);
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || preview) return;
    setServerError(null);
    setOtpBusy(true);
    try {
      const res = await postJson("/api/portal/otp/verify", { challengeId: otp.challengeId, code: otpCode, mac: unifiCtx.mac });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data?.error ?? dict.portal.networkError);
        return;
      }
      goToSuccess(data);
    } catch {
      setServerError(dict.portal.networkError);
    } finally {
      setOtpBusy(false);
    }
  };

  const resendOtp = async () => {
    if (!lastValues.current || resendIn > 0) return;
    setServerError(null);
    setOtpBusy(true);
    try {
      await startOtp(lastValues.current);
    } catch {
      setServerError(dict.portal.networkError);
    } finally {
      setOtpBusy(false);
    }
  };

  const needsOtp = verificationMode !== "none" && !social;

  const onSubmit = async (values: GuestRegistrationInput) => {
    if (preview) return;
    setServerError(null);
    try {
      if (needsOtp) {
        await startOtp(values);
        return;
      }
      const res = await postJson("/api/portal/authorize", {
        ...values,
        fingerprint: fingerprintRef.current,
        socialTicket: social?.ticket,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data?.error ?? dict.portal.networkError);
        return;
      }
      goToSuccess(data);
    } catch {
      setServerError(dict.portal.networkError);
    }
  };

  const reconnect = async () => {
    if (preview) return;
    setServerError(null);
    setReconnecting(true);
    try {
      const res = await fetch("/api/portal/reconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...unifiCtx, fingerprint: fingerprintRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 410) {
        setShowReturning(false);
        return;
      }
      if (!res.ok) {
        setServerError(data?.error ?? dict.portal.networkError);
        return;
      }
      goToSuccess(data);
    } catch {
      setServerError(dict.portal.networkError);
    } finally {
      setReconnecting(false);
    }
  };

  if (!unifiCtx.mac) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{dict.portal.unavailableAccess}</CardTitle>
          <CardDescription>{dict.portal.unavailableDesc}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const quickAccess =
    config.fieldName === "hidden" &&
    config.fieldEmail === "hidden" &&
    config.fieldPhone === "hidden" &&
    config.fieldDocument === "hidden";

  const label = (text: string, mode: FieldMode) => (mode === "optional" ? `${text} ${dict.portal.optionalSuffix}` : text);

  const header = (
    <CardHeader className="text-center">
      {branding.logoUrl && (
        <div className="relative mx-auto mb-4 flex h-16 w-full justify-center">
          <Image
            src={branding.logoUrl}
            alt={branding.brandName || "Logo"}
            fill
            // Logo pode ser URL externa arbitrária (next/image exigiria remotePatterns).
            unoptimized
            className="object-contain"
            priority
            sizes="(max-width: 768px) 100vw, 20vw"
          />
        </div>
      )}
      <CardTitle className="text-2xl">{branding.brandName}</CardTitle>
      {!showReturning && !otp && (
        <CardDescription>{quickAccess ? dict.portal.quickAccessDesc : dict.portal.fillDataDesc}</CardDescription>
      )}
    </CardHeader>
  );

  const previewBanner = preview && (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-2 text-center text-xs text-amber-800">
      {dict.portal.previewBanner}
    </div>
  );

  const errorBox = serverError && (
    <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
      {serverError}
    </div>
  );

  if (showReturning && returning) {
    return (
      <Card className="w-full max-w-md shadow-xl">
        {header}
        <CardContent className="space-y-4 text-center">
          {previewBanner}
          <div>
            <p className="text-lg font-semibold">
              {returning.firstName
                ? dict.portal.welcomeBack.replace("{name}", returning.firstName)
                : dict.portal.welcomeBackNoName}
            </p>
            <p className="text-sm text-muted-foreground">{dict.portal.welcomeBackDesc}</p>
          </div>
          {errorBox}
          <Button className="h-12 w-full text-base" onClick={reconnect} disabled={reconnecting || preview}>
            {reconnecting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {dict.portal.connecting}
              </>
            ) : (
              dict.portal.reconnectBtn
            )}
          </Button>
          <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-4"
            onClick={() => setShowReturning(false)}
          >
            {dict.portal.notMeBtn}
          </button>
        </CardContent>
      </Card>
    );
  }

  if (otp) {
    return (
      <Card className="w-full max-w-md shadow-xl">
        {header}
        <CardContent>
          <form className="space-y-4" onSubmit={verifyOtp} noValidate>
            <div className="space-y-1 text-center">
              <p className="text-lg font-semibold">{dict.portal.otpTitle}</p>
              <p className="text-sm text-muted-foreground">
                {(otp.channel === "email" ? dict.portal.otpSentEmail : dict.portal.otpSentSms).replace(
                  "{dest}",
                  otp.destination,
                )}
              </p>
              {otp.preAuthMinutes > 0 && (
                <p className="text-xs text-emerald-700">
                  {dict.portal.otpPreAuth.replace("{min}", String(otp.preAuthMinutes))}
                </p>
              )}
            </div>
            <Field id="otpCode" label={dict.portal.otpCodeLabel}>
              <Input
                id="otpCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="text-center font-mono text-2xl tracking-[0.5em]"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                autoFocus
              />
            </Field>
            {errorBox}
            <Button type="submit" className="h-12 w-full text-base" disabled={otpBusy || otpCode.length !== 6}>
              {otpBusy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
              {dict.portal.otpVerifyBtn}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-4"
                onClick={() => {
                  setOtp(null);
                  setServerError(null);
                }}
              >
                {dict.portal.otpEditBtn}
              </button>
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-4 disabled:no-underline disabled:opacity-60"
                disabled={resendIn > 0 || otpBusy}
                onClick={resendOtp}
              >
                {resendIn > 0 ? dict.portal.otpResendIn.replace("{s}", String(resendIn)) : dict.portal.otpResendBtn}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  const socialQuery = new URLSearchParams(
    Object.entries({
      id: unifiCtx.mac,
      ap: unifiCtx.apMac ?? "",
      ssid: unifiCtx.ssid ?? "",
      site: unifiCtx.site ?? "",
      url: unifiCtx.originalUrl ?? "",
    }).filter(([, v]) => v),
  ).toString();

  return (
    <Card className="w-full max-w-md shadow-xl">
      {header}
      <CardContent>
        {previewBanner}
        {socialError && !social && (
          <div role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {dict.portal.socialError}
          </div>
        )}
        {social ? (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {dict.portal.socialSignedAs
              .replace("{provider}", PROVIDER_LABEL[social.provider])
              .replace("{name}", social.name)
              .replace("{email}", social.email)}
          </div>
        ) : (
          socialProviders.length > 0 && (
            <div className="mb-4 space-y-2">
              {socialProviders.map((p) => (
                <Button key={p} asChild variant="outline" className="h-12 w-full text-base">
                  <a href={preview ? "#" : `/api/portal/oauth/${p}/start?${socialQuery}`}>
                    {dict.portal.socialContinue.replace("{provider}", PROVIDER_LABEL[p])}
                  </a>
                </Button>
              ))}
              <p className="pt-1 text-center text-xs text-muted-foreground">{dict.portal.socialOr}</p>
            </div>
          )
        )}
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <input type="hidden" {...register("mac")} />
          <input type="hidden" {...register("apMac")} />
          <input type="hidden" {...register("ssid")} />
          <input type="hidden" {...register("site")} />
          <input type="hidden" {...register("originalUrl")} />

          {config.fieldName !== "hidden" && !social && (
            <Field id="fullName" label={label(dict.portal.fullNameLabel, config.fieldName)} error={errors.fullName?.message}>
              <Input id="fullName" placeholder={dict.portal.fullNamePlaceholder} autoComplete="name" {...register("fullName")} />
            </Field>
          )}

          {config.fieldEmail !== "hidden" && !social && (
            <Field id="email" label={label(dict.portal.emailLabel, config.fieldEmail)} error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                placeholder={dict.portal.emailPlaceholder}
                autoComplete="email"
                {...register("email")}
              />
            </Field>
          )}

          {config.fieldDocument !== "hidden" && config.allowForeignDocument && (
            <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 rounded border-gray-300"
                checked={foreign}
                onChange={(e) => setValue("documentType", e.target.checked ? "passport" : "cpf")}
              />
              {dict.portal.foreignToggle}
            </label>
          )}

          {config.fieldPhone !== "hidden" && (
            <Field id="phone" label={label(dict.portal.phoneLabel, config.fieldPhone)} error={errors.phone?.message}>
              <Input
                id="phone"
                inputMode="tel"
                autoComplete="tel"
                placeholder={foreign ? "+1 555 123 4567" : "(11) 91234-5678"}
                value={foreign || (phone ?? "").startsWith("+") ? (phone ?? "") : maskPhoneBR(phone || "")}
                onChange={(e) => setValue("phone", e.target.value, { shouldValidate: Boolean(errors.phone) })}
              />
              {foreign && <p className="mt-1 text-xs text-muted-foreground">{dict.portal.phoneIntlHint}</p>}
            </Field>
          )}

          {config.fieldDocument !== "hidden" &&
            (foreign ? (
              <Field
                id="document"
                label={label(dict.portal.documentLabel, config.fieldDocument)}
                error={errors.document?.message}
              >
                <Input
                  id="document"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={dict.portal.documentPlaceholder}
                  {...register("document")}
                />
              </Field>
            ) : (
              <Field id="cpf" label={label(dict.portal.cpfLabel, config.fieldDocument)} error={errors.cpf?.message}>
                <Input
                  id="cpf"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  value={maskCPF(cpf || "")}
                  onChange={(e) => setValue("cpf", e.target.value, { shouldValidate: Boolean(errors.cpf) })}
                />
              </Field>
            ))}

          {config.requireToken && (
            <Field id="token" label={dict.portal.tokenLabel} error={errors.token?.message as string | undefined}>
              <Input
                id="token"
                placeholder={dict.portal.tokenPlaceholder}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={formatTokenCode(token || "")}
                onChange={(e) =>
                  setValue("token", formatTokenCode(e.target.value), { shouldValidate: Boolean(errors.token) })
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">{dict.portal.tokenHint}</p>
            </Field>
          )}

          <label className="-ml-3 flex min-h-[48px] cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-slate-50">
            <input
              type="checkbox"
              className="mt-0.5 h-6 w-6 shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
              {...register("acceptTerms")}
            />
            <span className="text-base leading-snug text-slate-600">
              {dict.portal.acceptPrefix} <TermsModal terms={branding.termsOfUse} dict={dict} /> {dict.portal.acceptSuffix}
            </span>
          </label>
          {errors.acceptTerms && <p className="text-xs text-destructive">{errors.acceptTerms.message as string}</p>}

          {marketing.enabled && (
            <label className="-ml-3 flex cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300"
                {...register("marketingConsent")}
              />
              <span className="text-sm leading-snug text-slate-600">
                {marketing.text || dict.portal.marketingConsentDefault}
              </span>
            </label>
          )}

          {errorBox}

          <Button
            type="submit"
            className="h-12 w-full text-base transition-all disabled:cursor-not-allowed disabled:opacity-75"
            disabled={isSubmitting || preview}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {dict.portal.connecting}
              </>
            ) : needsOtp ? (
              dict.portal.sendCodeBtn
            ) : (
              dict.portal.connectBtn
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
