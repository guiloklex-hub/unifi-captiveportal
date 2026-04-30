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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getGuestRegistrationSchema,
  type GuestRegistrationInput,
} from "@/lib/validators";
import { maskCPF, maskPhoneBR } from "@/lib/masks";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { SystemSettings } from "@/lib/settings";

export function PortalForm({ settings, dict }: { settings: SystemSettings; dict: Dictionary }) {
  const router = useRouter();
  const params = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);

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

  const requireToken = Boolean(settings?.requireToken);
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
  } = useForm<GuestRegistrationInput>({
    resolver: zodResolver(getGuestRegistrationSchema(dict.validation, { requireToken })),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      cpf: "",
      token: "",
      acceptTerms: false as unknown as true,
      ...unifiCtx,
    },
  });

  const cpf = watch("cpf");
  const phone = watch("phone");
  const token = watch("token");

  const formatToken = (raw: string): string => {
    const cleaned = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const parts: string[] = [];
    for (let i = 0; i < cleaned.length; i += 4) parts.push(cleaned.slice(i, i + 4));
    return parts.join("-");
  };

  const onSubmit = async (values: GuestRegistrationInput) => {
    setServerError(null);
    try {
      const res = await fetch("/api/portal/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, fingerprint: fingerprintRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data?.error ?? dict.portal.networkError);
        return;
      }
      const target = data?.redirect || unifiCtx.originalUrl || "";
      const id = data?.id ? `&id=${data.id}` : "";
      router.push(`/portal/success?${target ? `url=${encodeURIComponent(target)}` : ""}${id}`);
    } catch {
      setServerError(dict.portal.networkError);
    }
  };

  if (!unifiCtx.mac) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{dict.portal.unavailableAccess}</CardTitle>
          <CardDescription>
            {dict.portal.unavailableDesc}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="text-center">
        {settings?.logoUrl && (
          <div className="mb-4 flex justify-center relative h-16 w-full mx-auto">
            <Image 
              src={settings.logoUrl} 
              alt={settings.brandName || "Logo"}
              fill
              className="object-contain"
              priority
              sizes="(max-width: 768px) 100vw, 20vw"
            />
          </div>
        )}
        <CardTitle className="text-2xl">{settings.brandName}</CardTitle>
        <CardDescription>{dict.portal.fillDataDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <input type="hidden" {...register("mac")} />
          <input type="hidden" {...register("apMac")} />
          <input type="hidden" {...register("ssid")} />
          <input type="hidden" {...register("site")} />
          <input type="hidden" {...register("originalUrl")} />

          <Field label={dict.portal.fullNameLabel} error={errors.fullName?.message}>
            <Input placeholder={dict.portal.fullNamePlaceholder} autoComplete="name" {...register("fullName")} />
          </Field>

          <Field label={dict.portal.emailLabel} error={errors.email?.message}>
            <Input
              type="email"
              placeholder={dict.portal.emailPlaceholder}
              autoComplete="email"
              {...register("email")}
            />
          </Field>

          <Field label={dict.portal.phoneLabel} error={errors.phone?.message}>
            <Input
              inputMode="tel"
              placeholder="(11) 91234-5678"
              value={maskPhoneBR(phone || "")}
              onChange={(e) => setValue("phone", e.target.value, { shouldValidate: true })}
            />
          </Field>

          <Field label={dict.portal.cpfLabel} error={errors.cpf?.message}>
            <Input
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={maskCPF(cpf || "")}
              onChange={(e) => setValue("cpf", e.target.value, { shouldValidate: true })}
            />
          </Field>

          {requireToken && (
            <Field label={dict.portal.tokenLabel} error={errors.token?.message as string | undefined}>
              <Input
                placeholder={dict.portal.tokenPlaceholder}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={formatToken(token || "")}
                onChange={(e) => setValue("token", formatToken(e.target.value), { shouldValidate: true })}
              />
              <p className="text-xs text-muted-foreground mt-1">{dict.portal.tokenHint}</p>
            </Field>
          )}

          <label className="flex items-start gap-3 p-3 -ml-3 rounded-lg hover:bg-slate-50 cursor-pointer min-h-[48px]">
            <input
              type="checkbox"
              className="mt-0.5 h-6 w-6 rounded border-gray-300 text-primary focus:ring-primary shrink-0"
              {...register("acceptTerms")}
            />
            <span className="text-base text-slate-600 leading-snug">
              {dict.portal.acceptPrefix} <TermsModal terms={settings.termsOfUse} dict={dict} /> {dict.portal.acceptSuffix}
            </span>
          </label>
          {errors.acceptTerms && (
            <p className="text-xs text-destructive">{errors.acceptTerms.message as string}</p>
          )}

          {serverError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full bg-primary text-primary-foreground h-12 text-base transition-all disabled:opacity-75 disabled:cursor-not-allowed" 
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                {dict.portal.connecting}
              </>
            ) : dict.portal.connectBtn}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
