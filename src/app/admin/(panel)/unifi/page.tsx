"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type AuthMode = "auto" | "apikey" | "password";
type Strategy = "integration" | "legacy-apikey" | "legacy-session";

type ConnectionView = {
  source: "env" | "db";
  url: string;
  site: string;
  authMode: AuthMode;
  username: string | null;
  hasPassword: boolean;
  hasApiKey: boolean;
  insecureTls: boolean;
};

type Diagnostics = {
  variant: "unifi-os" | "classic" | "unknown";
  version: string | null;
  activeStrategy: Strategy | null;
  sites: { name: string; description: string }[];
  strategies: { strategy: Strategy; configured: boolean; ok: boolean; latencyMs: number | null; error: string | null }[];
  hint: string | null;
};

type Form = {
  url: string;
  site: string;
  authMode: AuthMode;
  username: string;
  password: string;
  apiKey: string;
  clearPassword: boolean;
  clearApiKey: boolean;
  insecureTls: boolean;
};

const selectClass =
  "flex h-12 w-full rounded-md border border-input bg-background px-4 py-2 text-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export default function UniFiConnectionPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [view, setView] = useState<ConnectionView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const applyView = (v: ConnectionView) => {
    setView(v);
    setForm({
      url: v.url,
      site: v.site,
      authMode: v.authMode,
      username: v.username ?? "",
      password: "",
      apiKey: "",
      clearPassword: false,
      clearApiKey: false,
      insecureTls: v.insecureTls,
    });
  };

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
    fetch("/api/admin/unifi/connection")
      .then((r) => r.json())
      .then(applyView)
      .catch(() => setMessage({ kind: "error", text: "Erro ao carregar a configuração" }));
  }, []);

  if (!form || !view) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {dict.admin.loading}
      </div>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const t = dict.admin;

  const errorText = async (res: Response) => {
    const j = await res.json().catch(() => ({}));
    const issues = j?.issues?.fieldErrors as Record<string, string[]> | undefined;
    const first = issues ? Object.values(issues).flat()[0] : null;
    return first ?? j?.error ?? `HTTP ${res.status}`;
  };

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/unifi/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: await errorText(res) });
        return;
      }
      setDiag(await res.json());
    } catch {
      setMessage({ kind: "error", text: t.connError });
    } finally {
      setTesting(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/unifi/connection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: await errorText(res) });
        return;
      }
      applyView(await res.json());
      setMessage({ kind: "ok", text: t.unifiSaved });
    } catch {
      setMessage({ kind: "error", text: t.connError });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm(t.unifiResetConfirm)) return;
    const res = await fetch("/api/admin/unifi/connection", { method: "DELETE" });
    if (res.ok) {
      applyView(await res.json());
      setDiag(null);
    }
  };

  const usesKey = form.authMode !== "password";
  const usesPassword = form.authMode !== "apikey";

  const strategyLabel: Record<Strategy, string> = {
    integration: t.unifiStrategyIntegration,
    "legacy-apikey": t.unifiStrategyLegacyApiKey,
    "legacy-session": t.unifiStrategyLegacySession,
  };
  const variantLabel = {
    "unifi-os": t.unifiVariantOs,
    classic: t.unifiVariantClassic,
    unknown: t.unifiVariantUnknown,
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.unifiTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.unifiDesc}</p>
        <p className="mt-2 inline-block rounded-md border bg-white px-2 py-1 text-xs text-muted-foreground">
          {view.source === "db" ? t.unifiSourceDb : t.unifiSourceEnv}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <form onSubmit={save} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.unifiUrlLabel}</CardTitle>
              <CardDescription>{t.unifiUrlHint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                aria-label={t.unifiUrlLabel}
                placeholder="https://192.168.1.1"
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                required
              />
              <div className="space-y-1.5">
                <Label htmlFor="site">{t.unifiSiteLabel}</Label>
                <Input id="site" value={form.site} onChange={(e) => set("site", e.target.value)} />
                <p className="text-xs text-muted-foreground">{t.unifiSiteHint}</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={form.insecureTls}
                  onChange={(e) => set("insecureTls", e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium">{t.unifiInsecureTlsLabel}</span>
                  <span className="block text-xs text-muted-foreground">{t.unifiInsecureTlsHint}</span>
                </span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.unifiAuthModeLabel}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <select
                  aria-label={t.unifiAuthModeLabel}
                  className={selectClass}
                  value={form.authMode}
                  onChange={(e) => set("authMode", e.target.value as AuthMode)}
                >
                  <option value="auto">{t.unifiModeAuto}</option>
                  <option value="apikey">{t.unifiModeApiKey}</option>
                  <option value="password">{t.unifiModePassword}</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {form.authMode === "auto"
                    ? t.unifiModeAutoHint
                    : form.authMode === "apikey"
                      ? t.unifiModeApiKeyHint
                      : t.unifiModePasswordHint}
                </p>
              </div>

              {usesKey && (
                <SecretField
                  id="apiKey"
                  label={t.unifiApiKeyLabel}
                  hint={t.unifiApiKeyHint}
                  value={form.apiKey}
                  saved={view.hasApiKey}
                  clearing={form.clearApiKey}
                  onChange={(v) => set("apiKey", v)}
                  onClear={() => set("clearApiKey", !form.clearApiKey)}
                  dict={dict}
                />
              )}

              {usesPassword && (
                <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="username">{t.unifiUserLabel}</Label>
                    <Input
                      id="username"
                      autoComplete="off"
                      value={form.username}
                      onChange={(e) => set("username", e.target.value)}
                    />
                  </div>
                  <SecretField
                    id="password"
                    label={t.unifiPasswordLabel}
                    value={form.password}
                    saved={view.hasPassword}
                    clearing={form.clearPassword}
                    onChange={(v) => set("password", v)}
                    onClear={() => set("clearPassword", !form.clearPassword)}
                    dict={dict}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {message && (
            <p
              role="status"
              className={message.kind === "ok" ? "text-sm text-emerald-700" : "text-sm text-destructive"}
            >
              {message.text}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {view.source === "db" && (
              <Button type="button" variant="ghost" onClick={reset}>
                {t.unifiResetBtn}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={test} disabled={testing}>
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t.unifiTesting}
                </>
              ) : (
                t.unifiTestBtn
              )}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t.savingBtn : t.unifiSaveBtn}
            </Button>
          </div>
        </form>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t.unifiDiagTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!diag ? (
              <p className="text-muted-foreground">{t.unifiDiagEmpty}</p>
            ) : (
              <>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t.unifiVariant}</dt>
                    <dd className="font-medium">{variantLabel[diag.variant]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t.unifiVersion}</dt>
                    <dd className="font-medium">{diag.version ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t.unifiActiveStrategy}</dt>
                    <dd className={diag.activeStrategy ? "font-medium text-emerald-700" : "font-medium text-destructive"}>
                      {diag.activeStrategy ? strategyLabel[diag.activeStrategy] : t.unifiNoStrategy}
                    </dd>
                  </div>
                </dl>

                <ul className="space-y-2 border-t pt-3">
                  {diag.strategies.map((s) => (
                    <li key={s.strategy} className="flex items-start gap-2">
                      {!s.configured ? (
                        <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      ) : s.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">
                          {strategyLabel[s.strategy]}
                          {s.ok && s.latencyMs !== null && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">{s.latencyMs} ms</span>
                          )}
                        </div>
                        {!s.configured && <div className="text-xs text-muted-foreground">{t.unifiNotConfigured}</div>}
                        {s.error && <div className="break-words text-xs text-muted-foreground">{s.error}</div>}
                      </div>
                    </li>
                  ))}
                </ul>

                {diag.hint && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <div className="mb-1 font-medium">{t.unifiHint}</div>
                    <p className="break-words">{diag.hint}</p>
                  </div>
                )}

                {diag.sites.length > 0 && (
                  <div className="border-t pt-3">
                    <div className="mb-1 text-xs text-muted-foreground">{t.unifiSitesFound}</div>
                    <ul className="space-y-1">
                      {diag.sites.map((s) => (
                        <li key={s.name}>
                          <button
                            type="button"
                            className="font-mono text-xs underline-offset-2 hover:underline"
                            onClick={() => set("site", s.name)}
                          >
                            {s.name}
                          </button>
                          <span className="ml-2 text-xs text-muted-foreground">{s.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SecretField({
  id,
  label,
  hint,
  value,
  saved,
  clearing,
  onChange,
  onClear,
  dict,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  saved: boolean;
  clearing: boolean;
  onChange: (v: string) => void;
  onClear: () => void;
  dict: Dictionary;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          placeholder={saved && !clearing ? "••••••••" : ""}
          value={value}
          disabled={clearing}
          onChange={(e) => onChange(e.target.value)}
        />
        {saved && (
          <Button type="button" variant="outline" onClick={onClear}>
            {clearing ? "↺" : dict.admin.unifiClear}
          </Button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {saved && !clearing && <p className="text-xs text-muted-foreground">{dict.admin.unifiSecretSaved}</p>}
      {clearing && <p className="text-xs text-amber-700">{dict.admin.unifiWillClear}</p>}
    </div>
  );
}
