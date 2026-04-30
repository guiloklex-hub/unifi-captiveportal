"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type TokenStatus = "active" | "expired" | "revoked" | "exhausted";

type Locks = {
  requireToken?: boolean;
  durationMin?: number;
  maxUses?: number;
  downKbps?: number;
  upKbps?: number;
  bytesQuotaMB?: number;
  expiresInMin?: number;
};

type TokenRow = {
  id: string;
  code: string;
  description: string | null;
  durationMin: number;
  downKbps: number | null;
  upKbps: number | null;
  bytesQuotaMB: number | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  site: string;
  status: TokenStatus;
};

const REL_OPTIONS = [
  { value: 60, key: "tokenExpRelHour" },
  { value: 360, key: "tokenExpRel6Hours" },
  { value: 1440, key: "tokenExpRelDay" },
  { value: 10080, key: "tokenExpRel7Days" },
  { value: 43200, key: "tokenExpRel30Days" },
] as const;

function localISOForInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusBadgeClass(status: TokenStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "expired":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "revoked":
      return "bg-rose-100 text-rose-700 border-rose-200";
    case "exhausted":
      return "bg-slate-200 text-slate-700 border-slate-300";
  }
}

export default function TokensPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TokenStatus | "">("");
  const [query, setQuery] = useState("");
  const [locks, setLocks] = useState<Locks>({});

  const [showForm, setShowForm] = useState(false);
  const [createdToken, setCreatedToken] = useState<TokenRow | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    description: "",
    durationMin: 480,
    downKbps: "",
    upKbps: "",
    bytesQuotaMB: "",
    maxUses: 1,
    site: "default",
    expirationMode: "relative" as "relative" | "absolute",
    relativeMin: 1440,
    absoluteAt: localISOForInput(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDict(dictionaries[getLocale(navigator.language)]);
    }
    fetch("/api/admin/tokens/locks")
      .then((r) => r.json())
      .then((data: Locks) => {
        setLocks(data ?? {});
        // Pré-preenche o formulário com os valores travados.
        setForm((prev) => ({
          ...prev,
          durationMin: data.durationMin ?? prev.durationMin,
          maxUses: data.maxUses ?? prev.maxUses,
          downKbps: data.downKbps !== undefined ? (data.downKbps === 0 ? "" : String(data.downKbps)) : prev.downKbps,
          upKbps: data.upKbps !== undefined ? (data.upKbps === 0 ? "" : String(data.upKbps)) : prev.upKbps,
          bytesQuotaMB: data.bytesQuotaMB !== undefined ? (data.bytesQuotaMB === 0 ? "" : String(data.bytesQuotaMB)) : prev.bytesQuotaMB,
          expirationMode: data.expiresInMin !== undefined ? "relative" : prev.expirationMode,
          relativeMin: data.expiresInMin ?? prev.relativeMin,
        }));
      })
      .catch(() => undefined);
  }, []);

  const isLocked = (field: keyof Locks): boolean => locks[field] !== undefined && locks[field] !== null;

  const fetchRows = useMemo(
    () => async () => {
      setLoading(true);
      const sp = new URLSearchParams();
      if (statusFilter) sp.set("status", statusFilter);
      if (query.trim()) sp.set("q", query.trim());
      const res = await fetch(`/api/admin/tokens?${sp.toString()}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setLoading(false);
    },
    [statusFilter, query],
  );

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const expiresAt =
        form.expirationMode === "relative"
          ? new Date(Date.now() + form.relativeMin * 60_000).toISOString()
          : new Date(form.absoluteAt).toISOString();

      const payload = {
        description: form.description.trim() || undefined,
        durationMin: Number(form.durationMin),
        downKbps: form.downKbps ? Number(form.downKbps) : undefined,
        upKbps: form.upKbps ? Number(form.upKbps) : undefined,
        bytesQuotaMB: form.bytesQuotaMB ? Number(form.bytesQuotaMB) : undefined,
        maxUses: Number(form.maxUses),
        site: form.site.trim() || "default",
        expiresAt,
      };

      const res = await fetch("/api/admin/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.error ?? "Erro ao criar token");
        return;
      }
      setCreatedToken(data);
      setShowForm(false);
      setForm({ ...form, description: "", downKbps: "", upKbps: "", bytesQuotaMB: "", maxUses: 1 });
      fetchRows();
    } catch {
      setFormError(dict.admin.connError);
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm(dict.admin.revokeTokenConfirm)) return;
    const cascade = confirm(dict.admin.revokeTokenCascadeConfirm);
    const res = await fetch(`/api/admin/tokens/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "revoke", cascade }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (cascade && typeof data?.disconnect?.attempted === "number") {
        alert(`${dict.admin.cascadeResult} ${data.disconnect.attempted - data.disconnect.failed}/${data.disconnect.attempted}`);
      }
      fetchRows();
    }
  };

  const extend = async (id: string) => {
    const minutesRaw = prompt(dict.admin.extendPromptMinutes);
    if (!minutesRaw) return;
    const minutes = Number(minutesRaw);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      alert(dict.admin.extendInvalid);
      return;
    }
    const usesRaw = prompt(dict.admin.extendPromptUses) ?? "0";
    const addUses = Number(usesRaw) || 0;
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const payload: { action: string; expiresAt: string; addUses?: number } = {
      action: "extend",
      expiresAt,
    };
    if (addUses > 0) payload.addUses = addUses;
    const res = await fetch(`/api/admin/tokens/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) fetchRows();
    else {
      const data = await res.json().catch(() => ({}));
      alert(data?.error ?? dict.admin.connError);
    }
  };

  const remove = async (id: string, usedCount: number) => {
    if (usedCount > 0) {
      alert(dict.admin.deleteTokenBlocked);
      return;
    }
    if (!confirm(dict.admin.deleteTokenConfirm)) return;
    const res = await fetch(`/api/admin/tokens/${id}`, { method: "DELETE" });
    if (res.ok) fetchRows();
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyMsg(dict.admin.copiedMsg);
      setTimeout(() => setCopyMsg(null), 1500);
    } catch {
      // navegadores antigos: ignora silenciosamente
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{dict.admin.tokensTitle}</h1>
          <p className="text-sm text-muted-foreground">{dict.admin.tokensDesc}</p>
        </div>
        <Button onClick={() => { setShowForm(!showForm); setCreatedToken(null); }}>
          {showForm ? dict.admin.cancelBtn : dict.admin.newTokenBtn}
        </Button>
      </div>

      {createdToken && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardHeader>
            <CardTitle>{dict.admin.tokenCreatedTitle}</CardTitle>
            <CardDescription>{dict.admin.tokenCreatedDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <code className="rounded-md bg-white border px-4 py-2 text-lg font-mono tracking-wider">
                {createdToken.code}
              </code>
              <Button type="button" variant="outline" onClick={() => copyCode(createdToken.code)}>
                {copyMsg ?? dict.admin.copyBtn}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.admin.newTokenBtn}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label>{dict.admin.tokenDescriptionLabel}</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={dict.admin.tokenDescriptionPlaceholder}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{dict.admin.tokenDurationLabel}</Label>
                <Input
                  type="number"
                  min={1}
                  max={43200}
                  value={form.durationMin}
                  disabled={isLocked("durationMin")}
                  onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
                  required
                />
                {isLocked("durationMin") && <p className="text-xs text-amber-700">{dict.admin.lockedByEnv}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{dict.admin.tokenMaxUsesLabel}</Label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.maxUses}
                  disabled={isLocked("maxUses")}
                  onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })}
                  required
                />
                {isLocked("maxUses") && <p className="text-xs text-amber-700">{dict.admin.lockedByEnv}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>
                  {dict.admin.tokenDownLabel}{" "}
                  <span className="text-xs text-muted-foreground">({dict.admin.tokenOptionalHint})</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={form.downKbps}
                  disabled={isLocked("downKbps")}
                  onChange={(e) => setForm({ ...form, downKbps: e.target.value })}
                />
                {isLocked("downKbps") && <p className="text-xs text-amber-700">{dict.admin.lockedByEnv}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>
                  {dict.admin.tokenUpLabel}{" "}
                  <span className="text-xs text-muted-foreground">({dict.admin.tokenOptionalHint})</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={form.upKbps}
                  disabled={isLocked("upKbps")}
                  onChange={(e) => setForm({ ...form, upKbps: e.target.value })}
                />
                {isLocked("upKbps") && <p className="text-xs text-amber-700">{dict.admin.lockedByEnv}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>
                  {dict.admin.tokenQuotaLabel}{" "}
                  <span className="text-xs text-muted-foreground">({dict.admin.tokenOptionalHint})</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={form.bytesQuotaMB}
                  disabled={isLocked("bytesQuotaMB")}
                  onChange={(e) => setForm({ ...form, bytesQuotaMB: e.target.value })}
                />
                {isLocked("bytesQuotaMB") && <p className="text-xs text-amber-700">{dict.admin.lockedByEnv}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{dict.admin.tokenSiteLabel}</Label>
                <Input
                  value={form.site}
                  onChange={(e) => setForm({ ...form, site: e.target.value })}
                  placeholder="default"
                />
                <p className="text-xs text-muted-foreground">{dict.admin.tokenSiteHint}</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{dict.admin.tokenExpirationLabel}</Label>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className={`flex items-center gap-2 ${isLocked("expiresInMin") ? "opacity-60" : ""}`}>
                    <input
                      type="radio"
                      checked={form.expirationMode === "relative"}
                      disabled={isLocked("expiresInMin")}
                      onChange={() => setForm({ ...form, expirationMode: "relative" })}
                    />
                    {dict.admin.tokenExpModeRelative}
                  </label>
                  <label className={`flex items-center gap-2 ${isLocked("expiresInMin") ? "opacity-60" : ""}`}>
                    <input
                      type="radio"
                      checked={form.expirationMode === "absolute"}
                      disabled={isLocked("expiresInMin")}
                      onChange={() => setForm({ ...form, expirationMode: "absolute" })}
                    />
                    {dict.admin.tokenExpModeAbsolute}
                  </label>
                </div>
                {form.expirationMode === "relative" ? (
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
                    value={form.relativeMin}
                    disabled={isLocked("expiresInMin")}
                    onChange={(e) => setForm({ ...form, relativeMin: Number(e.target.value) })}
                  >
                    {REL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {dict.admin[opt.key]}
                      </option>
                    ))}
                    {isLocked("expiresInMin") && !REL_OPTIONS.some((o) => o.value === locks.expiresInMin) && (
                      <option value={locks.expiresInMin}>{locks.expiresInMin} min</option>
                    )}
                  </select>
                ) : (
                  <Input
                    type="datetime-local"
                    value={form.absoluteAt}
                    disabled={isLocked("expiresInMin")}
                    onChange={(e) => setForm({ ...form, absoluteAt: e.target.value })}
                  />
                )}
                {isLocked("expiresInMin") && <p className="text-xs text-amber-700">{dict.admin.lockedByEnv}</p>}
              </div>

              {formError && (
                <div className="md:col-span-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {formError}
                </div>
              )}

              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  {dict.admin.cancelBtn}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? dict.admin.savingBtn : dict.admin.newTokenBtn}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{dict.admin.filterStatusLabel}</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TokenStatus | "")}
              >
                <option value="">{dict.admin.statusAll}</option>
                <option value="active">{dict.admin.statusActive}</option>
                <option value="expired">{dict.admin.statusExpired}</option>
                <option value="revoked">{dict.admin.statusRevoked}</option>
                <option value="exhausted">{dict.admin.statusExhausted}</option>
              </select>
            </div>
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs">{dict.admin.filterSearchLabel}</Label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={dict.admin.filterSearchPlaceholder}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">{dict.admin.tableTokenCode}</th>
                  <th className="py-2 pr-3">{dict.admin.tableTokenDescription}</th>
                  <th className="py-2 pr-3">{dict.admin.tableTokenStatus}</th>
                  <th className="py-2 pr-3">{dict.admin.tableTokenUses}</th>
                  <th className="py-2 pr-3">{dict.admin.tableTokenExpiration}</th>
                  <th className="py-2 pr-3">{dict.admin.tableTokenLimits}</th>
                  <th className="py-2 pr-3 text-right">{dict.admin.tableTokenActions}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{dict.admin.loading}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{dict.admin.noTokens}</td></tr>
                ) : (
                  rows.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono">{t.code}</td>
                      <td className="py-2 pr-3">{t.description ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(t.status)}`}>
                          {dict.admin[`status${t.status.charAt(0).toUpperCase() + t.status.slice(1)}` as keyof typeof dict.admin] as string}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{t.usedCount}/{t.maxUses}</td>
                      <td className="py-2 pr-3">{new Date(t.expiresAt).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-xs">
                        <div>{t.durationMin} min</div>
                        {(t.downKbps || t.upKbps) && (
                          <div className="text-muted-foreground">
                            ↓{t.downKbps ?? "—"} / ↑{t.upKbps ?? "—"} Kbps
                          </div>
                        )}
                        {t.bytesQuotaMB && (
                          <div className="text-muted-foreground">{t.bytesQuotaMB} MB</div>
                        )}
                        {t.site && t.site !== "default" && (
                          <div className="text-muted-foreground">site: {t.site}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right space-x-2 whitespace-nowrap">
                        {!t.revokedAt && t.status !== "expired" && (
                          <Button size="sm" variant="ghost" onClick={() => extend(t.id)}>
                            {dict.admin.extendBtn}
                          </Button>
                        )}
                        {!t.revokedAt && (
                          <Button size="sm" variant="outline" onClick={() => revoke(t.id)}>
                            {dict.admin.revokeTokenBtn}
                          </Button>
                        )}
                        {t.usedCount === 0 && (
                          <Button size="sm" variant="ghost" onClick={() => remove(t.id, t.usedCount)}>
                            {dict.admin.deleteTokenBtn}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
