"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

type Role = "admin" | "operator" | "viewer";
type User = {
  id: string;
  username: string;
  name: string | null;
  role: Role;
  totpEnabled: boolean;
  disabled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

async function errorOf(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({}));
  const issues = j?.issues?.fieldErrors as Record<string, string[]> | undefined;
  return (issues && Object.values(issues).flat()[0]) || j?.error || `HTTP ${res.status}`;
}

export default function UsersPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [users, setUsers] = useState<User[] | null>(null);
  const [form, setForm] = useState({ username: "", name: "", role: "operator" as Role, password: "" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const t = dict.admin;

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    setUsers(data.users ?? []);
    if ((data.users ?? []).length === 0) setForm((f) => ({ ...f, role: "admin" }));
  }, []);

  useEffect(() => {
    setDict(dictionaries[getLocale(navigator.language)]);
    load();
  }, [load]);

  const roleLabel: Record<Role, string> = { admin: t.roleAdmin, operator: t.roleOperator, viewer: t.roleViewer };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setMessage({ ok: false, text: await errorOf(res) });
      return;
    }
    const data = await res.json();
    setForm({ username: "", name: "", role: "operator", password: "" });
    if (data.legacyDisabled) {
      alert(t.usersFirstCreated);
      window.location.href = new URL("/admin/login?next=/admin/account", window.location.origin).toString();
      return;
    }
    setMessage({ ok: true, text: t.usersCreated });
    load();
  };

  const patch = async (u: User, body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) alert(await errorOf(res));
    load();
  };

  const resetPassword = async (u: User) => {
    const password = prompt(t.usersNewPasswordPrompt.replace("{user}", u.username));
    if (password) await patch(u, { password });
  };

  const remove = async (u: User) => {
    if (!confirm(t.usersDeleteConfirm.replace("{user}", u.username))) return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) alert(await errorOf(res));
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.navUsers}</h1>
        <p className="text-sm text-muted-foreground">{t.usersDesc}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.usersNew}</CardTitle>
          <CardDescription>{t.usersRolesHint}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">{t.usersUsername}</Label>
              <Input
                id="username"
                autoCapitalize="none"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">{t.usersName}</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">{t.usersRole}</Label>
              <select
                id="role"
                className={`${selectClass} h-12 w-full`}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                <option value="admin">{t.roleAdmin}</option>
                <option value="operator">{t.roleOperator}</option>
                <option value="viewer">{t.roleViewer}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t.usersPassword}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div className="flex items-center gap-3 md:col-span-4">
              <Button type="submit">{t.usersCreateBtn}</Button>
              <span className="text-xs text-muted-foreground">{t.usersPasswordPolicy}</span>
              {message && (
                <span role="status" className={message.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}>
                  {message.text}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {!users ? (
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.usersEmpty}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">{t.usersUsername}</th>
                  <th className="py-2 pr-3">{t.usersRole}</th>
                  <th className="py-2 pr-3">2FA</th>
                  <th className="py-2 pr-3">{t.usersStatus}</th>
                  <th className="py-2 pr-3">{t.usersLastLogin}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
                  return (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{u.username}</div>
                        {u.name && <div className="text-xs text-muted-foreground">{u.name}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          aria-label={t.usersRole}
                          className={selectClass}
                          value={u.role}
                          onChange={(e) => patch(u, { role: e.target.value })}
                        >
                          {(["admin", "operator", "viewer"] as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {roleLabel[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3">{u.totpEnabled ? "✓" : "—"}</td>
                      <td className="py-2 pr-3">
                        {u.disabled ? (
                          <span className="text-destructive">{t.usersDisabled}</span>
                        ) : locked ? (
                          <span className="text-amber-700">{t.usersLocked}</span>
                        ) : (
                          <span className="text-emerald-700">{t.usersActive}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}
                      </td>
                      <td className="space-x-1 whitespace-nowrap py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>
                          {t.usersResetPassword}
                        </Button>
                        {u.totpEnabled && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => patch(u, { resetTotp: true }, t.usersResetTotpConfirm.replace("{user}", u.username))}
                          >
                            {t.usersResetTotp}
                          </Button>
                        )}
                        {locked && (
                          <Button size="sm" variant="ghost" onClick={() => patch(u, { unlock: true })}>
                            {t.usersUnlock}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => patch(u, { disabled: !u.disabled })}>
                          {u.disabled ? t.usersEnable : t.usersDisable}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(u)}>
                          {t.deleteTokenBtn}
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
    </div>
  );
}
