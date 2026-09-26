"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type Rule = {
  id: string;
  kind: "block" | "allow";
  matchType: "mac" | "cpf" | "email" | "document";
  value: string;
  reason: string | null;
  durationMin: number | null;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

const selectClass =
  "flex h-12 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

const UNIT_MIN = { min: 1, h: 60, d: 1440 } as const;

async function errorOf(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({}));
  const issues = j?.issues?.fieldErrors as Record<string, string[]> | undefined;
  return (issues && Object.values(issues).flat()[0]) || j?.error || `HTTP ${res.status}`;
}

export default function AccessRulesPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [form, setForm] = useState({
    kind: "block" as Rule["kind"],
    matchType: "mac" as Rule["matchType"],
    value: "",
    reason: "",
    duration: "",
    unit: "d" as keyof typeof UNIT_MIN,
    expiresAt: "",
  });
  const [device, setDevice] = useState({ mac: "", label: "", site: "", duration: "30", unit: "d" as keyof typeof UNIT_MIN });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deviceMsg, setDeviceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const t = dict.admin;

  const load = useCallback(async () => {
    setRules((await (await fetch("/api/admin/access-rules")).json()).rules ?? []);
  }, []);

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
    load();
  }, [load]);

  const matchLabel: Record<Rule["matchType"], string> = {
    mac: "MAC",
    cpf: "CPF",
    email: t.fieldEmailLabel,
    document: t.rulesDocument,
  };

  const addRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/admin/access-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: form.kind,
        matchType: form.kind === "allow" ? "mac" : form.matchType,
        value: form.value,
        reason: form.reason || null,
        durationMin: form.kind === "allow" && form.duration ? Number(form.duration) * UNIT_MIN[form.unit] : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      }),
    });
    if (!res.ok) {
      setMsg({ ok: false, text: await errorOf(res) });
      return;
    }
    setForm({ ...form, value: "", reason: "", duration: "", expiresAt: "" });
    setMsg({ ok: true, text: t.rulesSaved });
    load();
  };

  const remove = async (r: Rule) => {
    if (!confirm(t.rulesRemoveConfirm.replace("{value}", r.value))) return;
    await fetch(`/api/admin/access-rules/${r.id}`, { method: "DELETE" });
    load();
  };

  const authorizeDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeviceMsg(null);
    const res = await fetch("/api/admin/guests/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mac: device.mac,
        label: device.label || null,
        site: device.site || null,
        minutes: Number(device.duration) * UNIT_MIN[device.unit],
      }),
    });
    if (!res.ok) {
      setDeviceMsg({ ok: false, text: await errorOf(res) });
      return;
    }
    setDeviceMsg({ ok: true, text: t.rulesDeviceAuthorized.replace("{mac}", device.mac) });
    setDevice({ ...device, mac: "", label: "" });
  };

  const unitSelect = (value: keyof typeof UNIT_MIN, onChange: (v: keyof typeof UNIT_MIN) => void, id: string) => (
    <select id={id} aria-label={t.rulesUnit} className={selectClass} value={value} onChange={(e) => onChange(e.target.value as keyof typeof UNIT_MIN)}>
      <option value="min">{t.rulesMinutes}</option>
      <option value="h">{t.rulesHours}</option>
      <option value="d">{t.rulesDays}</option>
    </select>
  );

  const section = (kind: Rule["kind"]) => {
    const list = (rules ?? []).filter((r) => r.kind === kind);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{kind === "block" ? t.rulesBlockTitle : t.rulesAllowTitle}</CardTitle>
          <CardDescription>{kind === "block" ? t.rulesBlockDesc : t.rulesAllowDesc}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.rulesEmpty}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {list.map((r) => {
                  const expired = r.expiresAt && new Date(r.expiresAt) <= new Date();
                  return (
                    <tr key={r.id} className={`border-b last:border-0 ${expired ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{matchLabel[r.matchType]}</td>
                      <td className="py-2 pr-3 font-mono">{r.value}</td>
                      <td className="py-2 pr-3 text-xs">
                        {r.reason ?? ""}
                        {r.durationMin ? ` · ${r.durationMin} min` : ""}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.expiresAt ? `${t.rulesUntil} ${new Date(r.expiresAt).toLocaleString()}` : t.rulesPermanent}
                        {r.createdBy ? ` · ${r.createdBy}` : ""}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                          {t.rulesRemove}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.navRules}</h1>
        <p className="text-sm text-muted-foreground">{t.rulesDesc}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.rulesNewTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addRule} className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="kind">{t.rulesKind}</Label>
              <select id="kind" className={selectClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Rule["kind"] })}>
                <option value="block">{t.rulesKindBlock}</option>
                <option value="allow">{t.rulesKindAllow}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="matchType">{t.rulesMatch}</Label>
              <select
                id="matchType"
                className={selectClass}
                value={form.kind === "allow" ? "mac" : form.matchType}
                disabled={form.kind === "allow"}
                onChange={(e) => setForm({ ...form, matchType: e.target.value as Rule["matchType"] })}
              >
                {(Object.keys(matchLabel) as Rule["matchType"][]).map((k) => (
                  <option key={k} value={k}>
                    {matchLabel[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="value">{t.rulesValue}</Label>
              <Input id="value" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">{t.rulesReason}</Label>
              <Input id="reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiresAt">{t.rulesExpires}</Label>
              <Input
                id="expiresAt"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </div>
            {form.kind === "allow" && (
              <div className="space-y-1.5">
                <Label htmlFor="duration">{t.rulesSessionDuration}</Label>
                <div className="flex gap-2">
                  <Input
                    id="duration"
                    type="number"
                    min={1}
                    placeholder={t.policyEnvPlaceholder}
                    value={form.duration}
                    onChange={(e) => setForm({ ...form, duration: e.target.value })}
                  />
                  {unitSelect(form.unit, (unit) => setForm({ ...form, unit }), "unit")}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 md:col-span-3">
              <Button type="submit">{t.rulesAddBtn}</Button>
              {msg && <span className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{msg.text}</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {section("block")}
      {section("allow")}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.rulesDeviceTitle}</CardTitle>
          <CardDescription>{t.rulesDeviceDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={authorizeDevice} className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="deviceMac">MAC</Label>
              <Input
                id="deviceMac"
                placeholder="aa:bb:cc:dd:ee:ff"
                value={device.mac}
                onChange={(e) => setDevice({ ...device, mac: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deviceLabel">{t.rulesDeviceLabel}</Label>
              <Input id="deviceLabel" placeholder={t.rulesDeviceLabelPlaceholder} value={device.label} onChange={(e) => setDevice({ ...device, label: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deviceSite">Site</Label>
              <Input id="deviceSite" placeholder="default" value={device.site} onChange={(e) => setDevice({ ...device, site: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deviceDuration">{t.rulesSessionDuration}</Label>
              <div className="flex gap-2">
                <Input
                  id="deviceDuration"
                  type="number"
                  min={1}
                  value={device.duration}
                  onChange={(e) => setDevice({ ...device, duration: e.target.value })}
                  required
                />
                {unitSelect(device.unit, (unit) => setDevice({ ...device, unit }), "deviceUnit")}
              </div>
            </div>
            <div className="flex items-center gap-3 md:col-span-4">
              <Button type="submit">{t.rulesDeviceBtn}</Button>
              {deviceMsg && (
                <span className={deviceMsg.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{deviceMsg.text}</span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
