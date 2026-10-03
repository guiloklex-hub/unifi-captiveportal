"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { safeAdminNextPath } from "@/lib/safeRedirect";

export function LoginForm({
  brandName,
  logoUrl,
  legacyMode,
}: {
  brandName: string;
  logoUrl: string | null;
  /** Nenhum usuário cadastrado: entra com ADMIN_PASSWORD. */
  legacyMode: boolean;
}) {
  const next = safeAdminNextPath(useSearchParams().get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const post = (url: string, body: unknown) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = mfaToken
        ? await post("/api/admin/login/mfa", { mfaToken, code })
        : await post("/api/admin/login", { username, password });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && mfaToken && /expirada/.test(data?.error ?? "")) {
          setMfaToken(null);
          setCode("");
        }
        // Sem corpo de erro e status 5xx = falha do servidor, não senha errada.
        setError(data?.error ?? (res.status >= 500 ? "Erro no servidor. Verifique os logs." : "Credenciais inválidas"));
        return;
      }
      if (data?.mfaRequired) {
        setMfaToken(data.mfaToken);
        return;
      }
      window.location.href = next;
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center">
          {logoUrl && (
            <div className="mb-4 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- logo pode ser URL externa arbitrária */}
              <img src={logoUrl} alt={brandName} className="max-h-12 object-contain" referrerPolicy="no-referrer" />
            </div>
          )}
          <CardTitle>{brandName || "Painel Administrativo"}</CardTitle>
          <CardDescription>{mfaToken ? "Verificação em duas etapas" : "Acesso restrito"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            {mfaToken ? (
              <div className="space-y-1.5">
                <Label htmlFor="code">Código do aplicativo autenticador</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  className="text-center font-mono text-xl tracking-[0.4em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                  required
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="username">Usuário</Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoFocus
                    placeholder={legacyMode ? "admin" : ""}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required={!legacyMode}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {legacyMode && (
                  <p className="text-xs text-muted-foreground">
                    Primeiro acesso: entre com a senha definida em <code>ADMIN_PASSWORD</code> e crie seu usuário em
                    Usuários.
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : mfaToken ? "Verificar" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
