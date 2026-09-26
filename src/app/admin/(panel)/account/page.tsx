"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type Account = {
  user: { username: string; name: string | null; role: string; totpEnabled: boolean } | null;
  legacy: boolean;
  role: string;
};

async function errorOf(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({}));
  const issues = j?.issues?.fieldErrors as Record<string, string[]> | undefined;
  return (issues && Object.values(issues).flat()[0]) || j?.error || `HTTP ${res.status}`;
}

export default function AccountPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [account, setAccount] = useState<Account | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [totpMsg, setTotpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const t = dict.admin;

  const load = useCallback(async () => {
    setAccount(await (await fetch("/api/admin/account")).json());
  }, []);

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
    load();
  }, [load]);

  if (!account) return <p className="text-sm text-muted-foreground">{t.loading}</p>;

  const json = (method: string, body?: unknown) => ({
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    const res = await fetch("/api/admin/account/password", json("POST", pw));
    if (!res.ok) {
      setPwMsg({ ok: false, text: await errorOf(res) });
      return;
    }
    alert(t.accountPasswordChanged);
    window.location.href = new URL("/admin/login?next=/admin/account", window.location.origin).toString();
  };

  const beginTotp = async () => {
    setTotpMsg(null);
    const res = await fetch("/api/admin/account/totp", json("POST"));
    if (!res.ok) {
      setTotpMsg({ ok: false, text: await errorOf(res) });
      return;
    }
    setSetup(await res.json());
    setCode("");
  };

  const confirmTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/account/totp", json("PUT", { code }));
    if (!res.ok) {
      setTotpMsg({ ok: false, text: await errorOf(res) });
      return;
    }
    setSetup(null);
    setTotpMsg({ ok: true, text: t.accountTotpEnabled });
    load();
  };

  const disableTotp = async () => {
    const c = prompt(t.accountTotpDisablePrompt);
    if (!c) return;
    const res = await fetch("/api/admin/account/totp", json("DELETE", { code: c }));
    if (!res.ok) {
      setTotpMsg({ ok: false, text: await errorOf(res) });
      return;
    }
    setTotpMsg({ ok: true, text: t.accountTotpDisabled });
    load();
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.navAccount}</h1>
        <p className="text-sm text-muted-foreground">
          {account.user ? `${account.user.username}${account.user.name ? ` — ${account.user.name}` : ""}` : "admin"}
        </p>
      </div>

      {account.legacy ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            {t.accountLegacy}{" "}
            <Link href="/admin/users" className="font-medium underline underline-offset-4">
              {t.legacyBannerLink}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.accountPasswordTitle}</CardTitle>
              <CardDescription>{t.usersPasswordPolicy}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="currentPassword">{t.accountCurrentPassword}</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={pw.currentPassword}
                    onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword">{t.accountNewPassword}</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={pw.newPassword}
                    onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                    required
                  />
                </div>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Button type="submit">{t.accountChangePasswordBtn}</Button>
                  {pwMsg && <span className={pwMsg.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>{pwMsg.text}</span>}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.accountTotpTitle}</CardTitle>
              <CardDescription>{t.accountTotpDesc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {account.user?.totpEnabled ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-emerald-700">✓ {t.accountTotpOn}</span>
                  <Button variant="outline" size="sm" onClick={disableTotp}>
                    {t.accountTotpDisableBtn}
                  </Button>
                </div>
              ) : setup ? (
                <form onSubmit={confirmTotp} className="space-y-4">
                  <p className="text-sm">{t.accountTotpScan}</p>
                  <div
                    className="h-48 w-48 rounded-md border bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
                    // SVG gerado pelo servidor (lib qrcode) a partir do otpauth://
                    dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t.accountTotpManual} <code className="break-all rounded bg-slate-100 px-1">{setup.secret}</code>
                  </p>
                  <div className="flex max-w-xs gap-2">
                    <Input
                      aria-label={t.otpCodeLabel}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                    />
                    <Button type="submit" disabled={code.length !== 6}>
                      {t.accountTotpConfirmBtn}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button onClick={beginTotp}>{t.accountTotpEnableBtn}</Button>
              )}
              {totpMsg && (
                <p role="status" className={totpMsg.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>
                  {totpMsg.text}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
