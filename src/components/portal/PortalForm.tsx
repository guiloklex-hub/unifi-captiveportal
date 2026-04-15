"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  guestRegistrationSchema,
  type GuestRegistrationInput,
} from "@/lib/validators";
import { maskCPF, maskPhoneBR } from "@/lib/masks";

export function PortalForm() {
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

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GuestRegistrationInput>({
    resolver: zodResolver(guestRegistrationSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      cpf: "",
      acceptTerms: false as unknown as true,
      ...unifiCtx,
    },
  });

  const cpf = watch("cpf");
  const phone = watch("phone");

  const onSubmit = async (values: GuestRegistrationInput) => {
    setServerError(null);
    try {
      const res = await fetch("/api/portal/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data?.error ?? "Falha ao autorizar acesso");
        return;
      }
      const target = data?.redirect || unifiCtx.originalUrl || "";
      router.push(`/portal/success${target ? `?url=${encodeURIComponent(target)}` : ""}`);
    } catch (err) {
      setServerError("Erro de rede. Tente novamente.");
    }
  };

  if (!unifiCtx.mac) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Acesso indisponível</CardTitle>
          <CardDescription>
            Esta página deve ser aberta automaticamente ao conectar na rede Wi-Fi Guest.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Bem-vindo(a)!</CardTitle>
        <CardDescription>Preencha seus dados para acessar o Wi-Fi gratuito.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <input type="hidden" {...register("mac")} />
          <input type="hidden" {...register("apMac")} />
          <input type="hidden" {...register("ssid")} />
          <input type="hidden" {...register("site")} />
          <input type="hidden" {...register("originalUrl")} />

          <Field label="Nome completo" error={errors.fullName?.message}>
            <Input placeholder="João da Silva" autoComplete="name" {...register("fullName")} />
          </Field>

          <Field label="E-mail" error={errors.email?.message}>
            <Input
              type="email"
              placeholder="voce@email.com"
              autoComplete="email"
              {...register("email")}
            />
          </Field>

          <Field label="Telefone (celular)" error={errors.phone?.message}>
            <Input
              inputMode="tel"
              placeholder="(11) 91234-5678"
              value={maskPhoneBR(phone || "")}
              onChange={(e) => setValue("phone", e.target.value, { shouldValidate: true })}
            />
          </Field>

          <Field label="CPF" error={errors.cpf?.message}>
            <Input
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={maskCPF(cpf || "")}
              onChange={(e) => setValue("cpf", e.target.value, { shouldValidate: true })}
            />
          </Field>

          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-1"
              {...register("acceptTerms")}
            />
            <span>
              Aceito os termos de uso e o tratamento dos meus dados conforme a LGPD.
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

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Conectando..." : "Conectar"}
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
