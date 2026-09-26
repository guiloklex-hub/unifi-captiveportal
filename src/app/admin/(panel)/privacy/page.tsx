"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type IdType = "cpf" | "email" | "document" | "phone";
type Summary = {
  count: number;
  anonymized: number;
  marketingConsents: number;
  firstAt: string | null;
  lastAt: string | null;
  name: string | null;
};
type TermsInfo = {
  versions: { hash: string; text: string; createdAt: string; acceptances: number }[];
  withoutVersion: number;
  anonymized: number;
  retentionDays: number;
  piiRetentionDays: number;
};

const selectClass =
  "flex h-12 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export default function PrivacyPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [idType, setIdType] = useState<IdType>("cpf");
  const [value, setValue] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<TermsInfo | null>(null);
  const t = dict.admin;

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
    fetch("/api/admin/privacy/terms")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  const qs = () => new URLSearchParams({ [idType]: value.trim() }).toString();

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSummary(null);
    const res = await fetch(`/api/admin/privacy/subject?${qs()}`);
    const data = await res.json();
    if (!res.ok) setError(data?.error ?? "Erro");
    else setSummary(data);
  };

  const anonymize = async () => {
    if (!confirm(t.privacyAnonymizeConfirm)) return;
    const res = await fetch("/api/admin/privacy/subject/anonymize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [idType]: value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) setError(data?.error ?? "Erro");
    else {
      alert(t.privacyAnonymized.replace("{n}", String(data.anonymized)));
      setSummary(null);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.navPrivacy}</h1>
        <p className="text-sm text-muted-foreground">{t.privacyDesc}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.privacySubjectTitle}</CardTitle>
          <CardDescription>{t.privacySubjectDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={search} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="idType">{t.privacyIdType}</Label>
              <select id="idType" className={selectClass} value={idType} onChange={(e) => setIdType(e.target.value as IdType)}>
                <option value="cpf">CPF</option>
                <option value="email">{t.fieldEmailLabel}</option>
                <option value="document">{t.rulesDocument}</option>
                <option value="phone">{t.fieldPhoneLabel}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="value">{t.rulesValue}</Label>
              <Input id="value" value={value} onChange={(e) => setValue(e.target.value)} required />
            </div>
            <Button type="submit">{t.privacySearchBtn}</Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {summary && (
            <div className="space-y-3 rounded-md border p-4 text-sm">
              {summary.count === 0 ? (
                <p>{t.privacyNone}</p>
              ) : (
                <>
                  <p>
                    {t.privacyFound
                      .replace("{n}", String(summary.count))
                      .replace("{first}", summary.firstAt ? new Date(summary.firstAt).toLocaleDateString() : "—")
                      .replace("{last}", summary.lastAt ? new Date(summary.lastAt).toLocaleDateString() : "—")}
                  </p>
                  <p className="text-muted-foreground">
                    {summary.name ? `${summary.name} · ` : ""}
                    {t.privacyMarketing}: {summary.marketingConsents} · {t.privacyAnonymizedCount}: {summary.anonymized}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline">
                      <a href={`/api/admin/privacy/subject/export?${qs()}`}>{t.privacyExportBtn}</a>
                    </Button>
                    <Button variant="outline" className="text-destructive" onClick={anonymize}>
                      {t.privacyAnonymizeBtn}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.privacyAnonymizeHint}</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {info && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.privacyRetentionTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{t.privacyRetentionConn.replace("{days}", String(info.retentionDays))}</p>
            <p>
              {info.piiRetentionDays > 0
                ? t.privacyRetentionPii.replace("{days}", String(info.piiRetentionDays))
                : t.privacyRetentionPiiOff}
            </p>
            <p className="text-muted-foreground">
              {t.privacyAnonymizedCount}: {info.anonymized}
            </p>
          </CardContent>
        </Card>
      )}

      {info && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.privacyTermsTitle}</CardTitle>
            <CardDescription>{t.privacyTermsDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {info.versions.length === 0 && <p className="text-muted-foreground">{t.noRecords}</p>}
            {info.versions.map((v) => (
              <details key={v.hash} className="rounded-md border p-3">
                <summary className="cursor-pointer">
                  <span className="font-mono text-xs">{v.hash.slice(0, 12)}</span> ·{" "}
                  {new Date(v.createdAt).toLocaleString()} · {t.privacyAcceptances}: {v.acceptances}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{v.text}</pre>
              </details>
            ))}
            {info.withoutVersion > 0 && (
              <p className="text-xs text-muted-foreground">{t.privacyLegacyRows.replace("{n}", String(info.withoutVersion))}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
