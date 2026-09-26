"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string;
  includePii: boolean;
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
};
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const EVENTS = ["guest.authorized", "guest.revoked", "rule.created"] as const;
const SCOPES = ["read", "read:pii", "write"] as const;
const selectClass =
  "flex h-12 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

async function errorOf(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({}));
  const issues = j?.issues?.fieldErrors as Record<string, string[]> | undefined;
  return (issues && Object.values(issues).flat()[0]) || j?.error || j?.reason || `HTTP ${res.status}`;
}

function SecretOnce({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <div className="font-medium">{label}</div>
      <code className="block break-all rounded bg-white px-2 py-1 font-mono text-xs">{value}</code>
      <div className="text-xs text-emerald-800">{hint}</div>
    </div>
  );
}

export default function IntegrationsPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [hookForm, setHookForm] = useState({ name: "", url: "", events: ["guest.authorized"] as string[], includePii: false });
  const [keyForm, setKeyForm] = useState({ name: "", scopes: ["read"] as string[] });
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [report, setReport] = useState<{ frequency: string; recipients: string } | null>(null);
  const [settingsRaw, setSettingsRaw] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string } | null>>({});
  const t = dict.admin;

  const load = useCallback(async () => {
    const [h, k, s] = await Promise.all([
      fetch("/api/admin/integrations/webhooks").then((r) => r.json()),
      fetch("/api/admin/integrations/api-keys").then((r) => r.json()),
      fetch("/api/admin/settings").then((r) => r.json()),
    ]);
    setHooks(h.webhooks ?? []);
    setKeys(k.keys ?? []);
    setSettingsRaw(s);
    setReport({ frequency: s.reportFrequency ?? "off", recipients: s.reportRecipients ?? "" });
  }, []);

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
    load();
  }, [load]);

  const say = (key: string, ok: boolean, text: string) => setMsg((m) => ({ ...m, [key]: { ok, text } }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const json = (method: string, body?: unknown) => ({
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const createHook = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/integrations/webhooks", json("POST", hookForm));
    if (!res.ok) return say("hook", false, await errorOf(res));
    setNewSecret((await res.json()).secret);
    setHookForm({ name: "", url: "", events: ["guest.authorized"], includePii: false });
    say("hook", true, t.intSaved);
    load();
  };

  const testHook = async (h: Webhook) => {
    const res = await fetch(`/api/admin/integrations/webhooks/${h.id}/test`, json("POST"));
    const data = await res.json().catch(() => ({}));
    alert(res.ok ? t.intTestOk.replace("{status}", String(data.status)) : `${t.intTestFail}: ${data.error ?? res.status}`);
    load();
  };

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/integrations/api-keys", json("POST", keyForm));
    if (!res.ok) return say("key", false, await errorOf(res));
    setNewKey((await res.json()).secret);
    setKeyForm({ name: "", scopes: ["read"] });
    load();
  };

  const saveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsRaw || !report) return;
    const payload = { ...settingsRaw, reportFrequency: report.frequency, reportRecipients: report.recipients };
    delete (payload as Record<string, unknown>).capabilities;
    for (const k of ["logoUrl", "backgroundUrl"]) (payload as Record<string, unknown>)[k] ??= "";
    const res = await fetch("/api/admin/settings", json("POST", payload));
    say("report", res.ok, res.ok ? t.intSaved : await errorOf(res));
  };

  const sendReport = async () => {
    const res = await fetch("/api/admin/reports/send?force=1", json("POST"));
    const data = await res.json().catch(() => ({}));
    say("report", res.ok && data.sent, data.sent ? t.intReportSent : `${t.intReportNotSent}: ${data.reason ?? data.error ?? res.status}`);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.navIntegrations}</h1>
        <p className="text-sm text-muted-foreground">{t.intDesc}</p>
      </div>

      {/* Webhooks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhooks</CardTitle>
          <CardDescription>{t.intWebhooksDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createHook} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hookName">{t.usersName}</Label>
              <Input id="hookName" placeholder="n8n / CRM" value={hookForm.name} onChange={(e) => setHookForm({ ...hookForm, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hookUrl">URL</Label>
              <Input id="hookUrl" placeholder="https://…" value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} required />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <span className="text-sm font-medium">{t.intEvents}</span>
              <div className="flex flex-wrap gap-4">
                {EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={hookForm.events.includes(ev)} onChange={() => setHookForm({ ...hookForm, events: toggle(hookForm.events, ev) })} />
                    <code>{ev}</code>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="mt-1" checked={hookForm.includePii} onChange={(e) => setHookForm({ ...hookForm, includePii: e.target.checked })} />
              <span>
                {t.intIncludePii}
                <span className="block text-xs text-muted-foreground">{t.intIncludePiiHint}</span>
              </span>
            </label>
            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit">{t.intAddWebhook}</Button>
              {msg.hook && <span className={msg.hook.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{msg.hook.text}</span>}
            </div>
          </form>
          {newSecret && <SecretOnce label={t.intSigningSecret} value={newSecret} hint={t.intShownOnce} />}
          {hooks.length > 0 && (
            <table className="w-full text-sm">
              <tbody>
                {hooks.map((h) => (
                  <tr key={h.id} className={`border-t align-top ${h.enabled ? "" : "opacity-50"}`}>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{h.name}</div>
                      <div className="break-all text-xs text-muted-foreground">{h.url}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {h.events.split(",").join(", ")}
                      {h.includePii && <div className="text-amber-700">{t.intWithPii}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {h.lastDeliveryAt ? (
                        <span className={h.lastError ? "text-destructive" : "text-emerald-700"}>
                          {h.lastError ?? `HTTP ${h.lastStatus}`} · {new Date(h.lastDeliveryAt).toLocaleString()}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="space-x-1 whitespace-nowrap py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => testHook(h)}>
                        {t.intTest}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await fetch(`/api/admin/integrations/webhooks/${h.id}`, json("PATCH", { enabled: !h.enabled }));
                          load();
                        }}
                      >
                        {h.enabled ? t.usersDisable : t.usersEnable}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={async () => {
                          if (!confirm(t.intDeleteConfirm)) return;
                          await fetch(`/api/admin/integrations/webhooks/${h.id}`, { method: "DELETE" });
                          load();
                        }}
                      >
                        {t.deleteTokenBtn}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* API pública */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.intApiTitle}</CardTitle>
          <CardDescription>{t.intApiDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createKey} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="keyName">{t.usersName}</Label>
              <Input id="keyName" placeholder="Power BI / PMS" value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t.intScopes}</span>
              <div className="flex flex-wrap gap-4 pt-2">
                {SCOPES.map((sc) => (
                  <label key={sc} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={keyForm.scopes.includes(sc)} onChange={() => setKeyForm({ ...keyForm, scopes: toggle(keyForm.scopes, sc) })} />
                    <code>{sc}</code>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground md:col-span-2">{t.intScopesHint}</p>
            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit">{t.intCreateKey}</Button>
              {msg.key && <span className={msg.key.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{msg.key.text}</span>}
            </div>
          </form>
          {newKey && <SecretOnce label={t.intApiKey} value={newKey} hint={t.intShownOnce} />}
          {keys.length > 0 && (
            <table className="w-full text-sm">
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className={`border-t ${k.revokedAt ? "opacity-50" : ""}`}>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{k.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">ucp_{k.prefix}_…</div>
                    </td>
                    <td className="py-2 pr-3 text-xs">{k.scopes}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {k.revokedAt ? t.intRevoked : k.lastUsedAt ? `${t.intLastUsed} ${new Date(k.lastUsedAt).toLocaleString()}` : t.intNeverUsed}
                    </td>
                    <td className="py-2 text-right">
                      {!k.revokedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={async () => {
                            if (!confirm(t.intRevokeConfirm)) return;
                            await fetch(`/api/admin/integrations/api-keys/${k.id}`, { method: "DELETE" });
                            load();
                          }}
                        >
                          {t.revokeTokenBtn}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{`curl -H "Authorization: Bearer ucp_…" ${origin}/api/v1/metrics?days=30
curl -H "Authorization: Bearer ucp_…" "${origin}/api/v1/registrations?since=2026-01-01T00:00:00Z&limit=100"
curl -H "Authorization: Bearer ucp_…" ${origin}/api/v1/sessions
curl -X POST -H "Authorization: Bearer ucp_…" -H "content-type: application/json" \\
  -d '{"durationMin":1440,"maxUses":1,"expiresAt":"2026-12-31T23:59:00Z"}' ${origin}/api/v1/vouchers`}</pre>
        </CardContent>
      </Card>

      {/* Relatório por e-mail */}
      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.intReportTitle}</CardTitle>
            <CardDescription>{t.intReportDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveReport} className="grid gap-4 md:grid-cols-[12rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="freq">{t.intReportFrequency}</Label>
                <select id="freq" className={selectClass} value={report.frequency} onChange={(e) => setReport({ ...report, frequency: e.target.value })}>
                  <option value="off">{t.verifyNone}</option>
                  <option value="daily">{t.intDaily}</option>
                  <option value="weekly">{t.intWeekly}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipients">{t.intRecipients}</Label>
                <Input id="recipients" placeholder="gerente@hotel.com, ti@hotel.com" value={report.recipients} onChange={(e) => setReport({ ...report, recipients: e.target.value })} />
              </div>
              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                <Button type="submit">{t.saveBtn}</Button>
                <Button type="button" variant="outline" onClick={sendReport}>
                  {t.intSendNow}
                </Button>
                {msg.report && <span className={msg.report.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{msg.report.text}</span>}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
