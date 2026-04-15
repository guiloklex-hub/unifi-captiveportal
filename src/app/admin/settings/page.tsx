"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    brandName: "",
    logoUrl: "",
    backgroundUrl: "",
    primaryColor: "#171717",
    termsOfUse: "",
  });

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings({
          brandName: data.brandName ?? "",
          logoUrl: data.logoUrl ?? "",
          backgroundUrl: data.backgroundUrl ?? "",
          primaryColor: data.primaryColor ?? "#171717",
          termsOfUse: data.termsOfUse ?? "",
        });
        setLoading(false);
      });
  }, []);

  const handleUpload = async (file: File, key: "logoUrl" | "backgroundUrl") => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, [key]: data.url }));
      } else {
        alert(data.error || "Erro no upload");
      }
    } catch (err) {
      alert("Erro ao conectar com servidor de upload");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        alert("Configurações salvas com sucesso!");
      } else {
        alert("Erro ao salvar configurações.");
      }
    } catch (err) {
      alert("Erro de conexão.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Customização</h1>
        <p className="text-sm text-muted-foreground">Personalize a identidade visual do seu portal</p>
      </div>

      <form onSubmit={save} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>Configure o nome e as imagens da sua marca</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome da Marca</Label>
              <Input
                value={settings.brandName}
                onChange={(e) => setSettings({ ...settings, brandName: e.target.value })}
                placeholder="Ex: Minha Empresa"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Logotipo</Label>
              <div className="flex gap-2">
                <Input
                  value={settings.logoUrl}
                  onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value })}
                  placeholder="URL externa ou upload local"
                />
                <div className="relative">
                  <Button type="button" variant="outline" className="cursor-pointer">
                    Upload
                    <input
                      type="file"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(file, "logoUrl");
                      }}
                    />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Plano de Fundo (Background)</Label>
              <div className="flex gap-2">
                <Input
                  value={settings.backgroundUrl}
                  onChange={(e) => setSettings({ ...settings, backgroundUrl: e.target.value })}
                  placeholder="URL externa ou upload local"
                />
                <div className="relative">
                  <Button type="button" variant="outline" className="cursor-pointer">
                    Upload
                    <input
                      type="file"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(file, "backgroundUrl");
                      }}
                    />
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Cor Primária (Hex)</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  className="w-12 p-1 h-10"
                  value={settings.primaryColor}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                />
                <Input
                  value={settings.primaryColor}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  placeholder="#171717"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Termos de Uso</CardTitle>
            <CardDescription>Texto que será exibido no formulário de acesso</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              className="min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={settings.termsOfUse}
              onChange={(e) => setSettings({ ...settings, termsOfUse: e.target.value })}
              placeholder="Escreva aqui os termos..."
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </div>
      </form>
    </div>
  );
}
