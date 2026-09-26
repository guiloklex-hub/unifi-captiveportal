"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type FieldMode = "required" | "optional" | "hidden";

type GlobalSettings = {
  brandName: string;
  logoUrl: string;
  backgroundUrl: string;
  primaryColor: string;
  termsOfUse: string;
  requireToken: boolean;
  singleDeviceByCpf: boolean;
  defaultDurationMin: string;
  defaultDownKbps: string;
  defaultUpKbps: string;
  defaultQuotaMB: string;
  fieldName: FieldMode;
  fieldEmail: FieldMode;
  fieldPhone: FieldMode;
  fieldDocument: FieldMode;
  allowForeignDocument: boolean;
  rememberDeviceDays: string;
  verificationMode: "none" | "email" | "sms";
  otpPreAuthMinutes: string;
  socialGoogle: boolean;
  socialMicrosoft: boolean;
  marketingConsentMode: "off" | "optional";
  marketingConsentText: string;
};

type Capabilities = {
  email: boolean;
  sms: boolean;
  google: boolean;
  microsoft: boolean;
  oauthRedirectUri: string | null;
};

type BrandingFields = Pick<GlobalSettings, "brandName" | "logoUrl" | "backgroundUrl" | "primaryColor" | "termsOfUse">;

const EMPTY_BRANDING: BrandingFields = { brandName: "", logoUrl: "", backgroundUrl: "", primaryColor: "", termsOfUse: "" };

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const textareaClass =
  "min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export default function SettingsPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [requireTokenLocked, setRequireTokenLocked] = useState(false);
  const [sites, setSites] = useState<string[]>([]);
  // "" = marca global (todos os sites); senão, sobrescritas do site escolhido.
  const [scope, setScope] = useState("");
  const [siteBranding, setSiteBranding] = useState<BrandingFields>(EMPTY_BRANDING);
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
    Promise.all([
      fetch("/api/admin/settings").then((r) => r.json()),
      fetch("/api/admin/tokens/locks").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/sites").then((r) => r.json()).catch(() => ({ sites: [] })),
    ]).then(([data, locks, siteList]) => {
      setSettings({
        brandName: str(data.brandName),
        logoUrl: str(data.logoUrl),
        backgroundUrl: str(data.backgroundUrl),
        primaryColor: data.primaryColor ?? "#171717",
        termsOfUse: str(data.termsOfUse),
        requireToken: Boolean(data.requireToken),
        singleDeviceByCpf: Boolean(data.singleDeviceByCpf),
        defaultDurationMin: str(data.defaultDurationMin),
        defaultDownKbps: str(data.defaultDownKbps),
        defaultUpKbps: str(data.defaultUpKbps),
        defaultQuotaMB: str(data.defaultQuotaMB),
        fieldName: data.fieldName ?? "required",
        fieldEmail: data.fieldEmail ?? "required",
        fieldPhone: data.fieldPhone ?? "required",
        fieldDocument: data.fieldDocument ?? "required",
        allowForeignDocument: Boolean(data.allowForeignDocument),
        rememberDeviceDays: str(data.rememberDeviceDays ?? 0),
        verificationMode: data.verificationMode ?? "none",
        otpPreAuthMinutes: str(data.otpPreAuthMinutes ?? 10),
        socialGoogle: Boolean(data.socialGoogle),
        socialMicrosoft: Boolean(data.socialMicrosoft),
        marketingConsentMode: data.marketingConsentMode === "optional" ? "optional" : "off",
        marketingConsentText: str(data.marketingConsentText),
      });
      setCaps(data.capabilities ?? null);
      setRequireTokenLocked(locks?.requireToken !== undefined && locks?.requireToken !== null);
      setSites(Array.isArray(siteList?.sites) ? siteList.sites : []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!scope) return;
    fetch(`/api/admin/branding/${encodeURIComponent(scope)}`)
      .then((r) => r.json())
      .then((d) =>
        setSiteBranding({
          brandName: str(d.brandName),
          logoUrl: str(d.logoUrl),
          backgroundUrl: str(d.backgroundUrl),
          primaryColor: str(d.primaryColor),
          termsOfUse: str(d.termsOfUse),
        }),
      )
      .catch(() => setSiteBranding(EMPTY_BRANDING));
  }, [scope]);

  if (loading || !settings) return <div>{dict.admin.loading}</div>;

  const t = dict.admin;
  const set = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) =>
    setSettings({ ...settings, [key]: value });

  // Campos de marca: editam a global ou as sobrescritas do site escolhido.
  const brand: BrandingFields = scope ? siteBranding : settings;
  const setBrand = (key: keyof BrandingFields, value: string) =>
    scope ? setSiteBranding({ ...siteBranding, [key]: value }) : set(key, value);
  const inherited = (key: keyof BrandingFields) => (scope ? settings[key] : "");

  const handleUpload = async (file: File, key: "logoUrl" | "backgroundUrl") => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) setBrand(key, data.url);
      else alert(data.error || t.uploadError);
    } catch {
      alert(t.connError);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...settings,
        defaultDurationMin: numOrNull(settings.defaultDurationMin),
        defaultDownKbps: numOrNull(settings.defaultDownKbps),
        defaultUpKbps: numOrNull(settings.defaultUpKbps),
        defaultQuotaMB: numOrNull(settings.defaultQuotaMB),
        rememberDeviceDays: Number(settings.rememberDeviceDays || 0),
        otpPreAuthMinutes: Number(settings.otpPreAuthMinutes || 0),
      };
      const requests = [
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ];
      if (scope) {
        requests.push(
          fetch(`/api/admin/branding/${encodeURIComponent(scope)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(siteBranding),
          }),
        );
      }
      const responses = await Promise.all(requests);
      const failed = responses.find((r) => !r.ok);
      if (failed) {
        const j = await failed.json().catch(() => ({}));
        const first = j?.issues?.fieldErrors ? Object.values(j.issues.fieldErrors as Record<string, string[]>).flat()[0] : null;
        alert(first ? `${t.saveError}: ${first}` : t.saveError);
      } else {
        alert(t.saveSuccess);
      }
    } catch {
      alert(t.connError);
    } finally {
      setSaving(false);
    }
  };

  const previewUrl = `/portal?preview=1&id=00:00:00:00:00:00${scope ? `&site=${encodeURIComponent(scope)}` : ""}`;
  const quickAccess = (["fieldName", "fieldEmail", "fieldPhone", "fieldDocument"] as const).every(
    (k) => settings[k] === "hidden",
  );

  const fieldSelect = (key: "fieldName" | "fieldEmail" | "fieldPhone" | "fieldDocument", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <select id={key} className={selectClass} value={settings[key]} onChange={(e) => set(key, e.target.value as FieldMode)}>
        <option value="required">{t.fieldRequired}</option>
        <option value="optional">{t.fieldOptional}</option>
        <option value="hidden">{t.fieldHidden}</option>
      </select>
    </div>
  );

  const imageField = (key: "logoUrl" | "backgroundUrl", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={key}
          value={brand[key]}
          onChange={(e) => setBrand(key, e.target.value)}
          placeholder={inherited(key) || t.urlPlaceholder}
        />
        <Button type="button" variant="outline" className="relative cursor-pointer">
          {t.uploadBtn}
          <input
            type="file"
            className="absolute inset-0 cursor-pointer opacity-0"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file, key);
            }}
          />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.settingsTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.settingsDesc}</p>
        </div>
        <Button asChild variant="outline">
          <a href={previewUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" /> {t.previewPortalBtn}
          </a>
        </Button>
      </div>

      <form onSubmit={save} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t.brandingTitle}</CardTitle>
            <CardDescription>{t.brandingDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="scope">{t.brandingScopeLabel}</Label>
              <select id="scope" className={selectClass} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">{t.brandingScopeAll}</option>
                {sites.map((s) => (
                  <option key={s} value={s}>
                    {t.brandingScopeSite.replace("{site}", s)}
                  </option>
                ))}
              </select>
              {scope && <p className="text-xs text-muted-foreground">{t.brandingScopeHint}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brandName">{t.brandNameLabel}</Label>
              <Input
                id="brandName"
                value={brand.brandName}
                onChange={(e) => setBrand("brandName", e.target.value)}
                placeholder={inherited("brandName") || t.brandNamePlaceholder}
              />
            </div>
            {imageField("logoUrl", t.logoLabel)}
            {imageField("backgroundUrl", t.bgLabel)}
            <div className="space-y-1.5">
              <Label htmlFor="primaryColor">{t.colorLabel}</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  aria-label={t.colorLabel}
                  className="h-10 w-12 p-1"
                  value={brand.primaryColor || settings.primaryColor}
                  onChange={(e) => setBrand("primaryColor", e.target.value)}
                />
                <Input
                  id="primaryColor"
                  value={brand.primaryColor}
                  onChange={(e) => setBrand("primaryColor", e.target.value)}
                  placeholder={inherited("primaryColor") || "#171717"}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.termsTitle}</CardTitle>
            <CardDescription>{t.termsDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              aria-label={t.termsTitle}
              className={textareaClass}
              value={brand.termsOfUse}
              onChange={(e) => setBrand("termsOfUse", e.target.value)}
              placeholder={scope ? t.brandingInheritPlaceholder : t.termsPlaceholder}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.formTitle}</CardTitle>
            <CardDescription>{t.formDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {fieldSelect("fieldName", t.fieldNameLabel)}
              {fieldSelect("fieldEmail", t.fieldEmailLabel)}
              {fieldSelect("fieldPhone", t.fieldPhoneLabel)}
              {fieldSelect("fieldDocument", t.fieldDocumentLabel)}
            </div>
            {quickAccess && <p className="text-xs text-emerald-700">{t.quickAccessOn}</p>}
            {settings.singleDeviceByCpf && settings.fieldDocument === "hidden" && (
              <p className="text-xs text-amber-700">{t.cpfLockNeedsDocument}</p>
            )}
            <label className="flex cursor-pointer items-start gap-3 border-t pt-4">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={settings.allowForeignDocument}
                disabled={settings.fieldDocument === "hidden"}
                onChange={(e) => set("allowForeignDocument", e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">{t.allowForeignLabel}</span>
                <span className="block text-xs text-muted-foreground">{t.allowForeignHint}</span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.verifyTitle}</CardTitle>
            <CardDescription>{t.verifyDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="verificationMode">{t.verifyModeLabel}</Label>
                <select
                  id="verificationMode"
                  className={selectClass}
                  value={settings.verificationMode}
                  onChange={(e) => set("verificationMode", e.target.value as GlobalSettings["verificationMode"])}
                >
                  <option value="none">{t.verifyNone}</option>
                  <option value="email">{t.verifyEmail}</option>
                  <option value="sms">{t.verifySms}</option>
                </select>
                {settings.verificationMode === "email" && caps && !caps.email && (
                  <p className="text-xs text-amber-700">{t.verifyEmailMissing}</p>
                )}
                {settings.verificationMode === "sms" && caps && !caps.sms && (
                  <p className="text-xs text-amber-700">{t.verifySmsMissing}</p>
                )}
                {settings.verificationMode !== "none" && (
                  <p className="text-xs text-muted-foreground">{t.verifyFieldForced}</p>
                )}
              </div>
              {settings.verificationMode === "email" && (
                <div className="space-y-1.5">
                  <Label htmlFor="otpPreAuthMinutes">{t.verifyPreAuthLabel}</Label>
                  <Input
                    id="otpPreAuthMinutes"
                    type="number"
                    min={0}
                    max={60}
                    value={settings.otpPreAuthMinutes}
                    onChange={(e) => set("otpPreAuthMinutes", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t.verifyPreAuthHint}</p>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t pt-4">
              {(
                [
                  ["socialGoogle", "Google", caps?.google],
                  ["socialMicrosoft", "Microsoft", caps?.microsoft],
                ] as const
              ).map(([key, label, configured]) => (
                <label key={key} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    checked={settings[key]}
                    onChange={(e) => set(key, e.target.checked)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{t.socialLabel.replace("{provider}", label)}</span>
                    {settings[key] && caps && (!configured || !caps.oauthRedirectUri) && (
                      <span className="block text-xs text-amber-700">{t.socialMissing}</span>
                    )}
                  </span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                {t.socialHint}
                {caps?.oauthRedirectUri && (
                  <>
                    {" "}
                    <code className="rounded bg-slate-100 px-1">{caps.oauthRedirectUri}</code>
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.policyTitle}</CardTitle>
            <CardDescription>{t.policyDesc}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["defaultDurationMin", t.policyDuration],
                ["defaultDownKbps", t.policyDown],
                ["defaultUpKbps", t.policyUp],
                ["defaultQuotaMB", t.policyQuota],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  type="number"
                  min={key === "defaultDurationMin" ? 1 : 0}
                  inputMode="numeric"
                  value={settings[key]}
                  placeholder={t.policyEnvPlaceholder}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">{t.policyHint}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.accessControlTitle}</CardTitle>
            <CardDescription>{t.accessControlDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <label className={`flex items-start gap-3 ${requireTokenLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                checked={settings.requireToken}
                disabled={requireTokenLocked}
                onChange={(e) => set("requireToken", e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">{t.requireTokenLabel}</span>
                <span className="block text-xs text-muted-foreground">{t.requireTokenHint}</span>
                {requireTokenLocked && <span className="mt-1 block text-xs text-amber-700">{t.lockedByEnv}</span>}
              </span>
            </label>

            <div className="mt-4 space-y-2 border-t pt-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={settings.marketingConsentMode === "optional"}
                  onChange={(e) => set("marketingConsentMode", e.target.checked ? "optional" : "off")}
                />
                <span>
                  <span className="block text-sm font-medium">{t.marketingLabel}</span>
                  <span className="block text-xs text-muted-foreground">{t.marketingHint}</span>
                </span>
              </label>
              {settings.marketingConsentMode === "optional" && (
                <Input
                  aria-label={t.marketingTextLabel}
                  placeholder={t.marketingTextPlaceholder}
                  value={settings.marketingConsentText}
                  onChange={(e) => set("marketingConsentText", e.target.value)}
                  maxLength={300}
                />
              )}
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 border-t pt-4">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                checked={settings.singleDeviceByCpf}
                onChange={(e) => set("singleDeviceByCpf", e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">{t.singleDeviceLabel}</span>
                <span className="block text-xs text-muted-foreground">{t.singleDeviceHint}</span>
              </span>
            </label>

            <div className="mt-4 space-y-1.5 border-t pt-4">
              <Label htmlFor="rememberDeviceDays">{t.rememberLabel}</Label>
              <Input
                id="rememberDeviceDays"
                type="number"
                min={0}
                max={365}
                className="max-w-32"
                value={settings.rememberDeviceDays}
                onChange={(e) => set("rememberDeviceDays", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t.rememberHint}</p>
              {settings.requireToken && Number(settings.rememberDeviceDays) > 0 && (
                <p className="text-xs text-amber-700">{t.rememberDisabledByToken}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? t.savingBtn : t.saveBtn}
          </Button>
        </div>
      </form>
    </div>
  );
}
