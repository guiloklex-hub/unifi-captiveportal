"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getLocale, dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

export default function SettingsPage() {
  const [dict, setDict] = useState<Dictionary>(dictionaries.pt);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    brandName: "",
    logoUrl: "",
    backgroundUrl: "",
    primaryColor: "#171717",
    termsOfUse: "",
    requireToken: false,
  });
  const [requireTokenLocked, setRequireTokenLocked] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDict(dictionaries[getLocale(navigator.language)]);
    }
    Promise.all([
      fetch("/api/admin/settings").then((r) => r.json()),
      fetch("/api/admin/tokens/locks").then((r) => r.json()).catch(() => ({})),
    ]).then(([data, locks]) => {
      setSettings({
        brandName: data.brandName ?? "",
        logoUrl: data.logoUrl ?? "",
        backgroundUrl: data.backgroundUrl ?? "",
        primaryColor: data.primaryColor ?? "#171717",
        termsOfUse: data.termsOfUse ?? "",
        requireToken: Boolean(data.requireToken),
      });
      setRequireTokenLocked(locks?.requireToken !== undefined && locks?.requireToken !== null);
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
        alert(data.error || dict.admin.uploadError);
      }
    } catch (err) {
      alert(dict.admin.connError);
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
        alert(dict.admin.saveSuccess);
      } else {
        alert(dict.admin.saveError);
      }
    } catch (err) {
      alert(dict.admin.connError);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>{dict.admin.loading}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{dict.admin.settingsTitle}</h1>
        <p className="text-sm text-muted-foreground">{dict.admin.settingsDesc}</p>
      </div>

      <form onSubmit={save} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{dict.admin.brandingTitle}</CardTitle>
            <CardDescription>{dict.admin.brandingDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{dict.admin.brandNameLabel}</Label>
              <Input
                value={settings.brandName}
                onChange={(e) => setSettings({ ...settings, brandName: e.target.value })}
                placeholder={dict.admin.brandNamePlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{dict.admin.logoLabel}</Label>
              <div className="flex gap-2">
                <Input
                  value={settings.logoUrl}
                  onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value })}
                  placeholder={dict.admin.urlPlaceholder}
                />
                <div className="relative">
                  <Button type="button" variant="outline" className="cursor-pointer">
                    {dict.admin.uploadBtn}
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
              <Label>{dict.admin.bgLabel}</Label>
              <div className="flex gap-2">
                <Input
                  value={settings.backgroundUrl}
                  onChange={(e) => setSettings({ ...settings, backgroundUrl: e.target.value })}
                  placeholder={dict.admin.urlPlaceholder}
                />
                <div className="relative">
                  <Button type="button" variant="outline" className="cursor-pointer">
                    {dict.admin.uploadBtn}
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
              <Label>{dict.admin.colorLabel}</Label>
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
            <CardTitle>{dict.admin.termsTitle}</CardTitle>
            <CardDescription>{dict.admin.termsDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              className="min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={settings.termsOfUse}
              onChange={(e) => setSettings({ ...settings, termsOfUse: e.target.value })}
              placeholder={dict.admin.termsPlaceholder}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{dict.admin.accessControlTitle}</CardTitle>
            <CardDescription>{dict.admin.accessControlDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <label className={`flex items-start gap-3 ${requireTokenLocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                checked={settings.requireToken}
                disabled={requireTokenLocked}
                onChange={(e) => setSettings({ ...settings, requireToken: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium">{dict.admin.requireTokenLabel}</span>
                <span className="block text-xs text-muted-foreground">{dict.admin.requireTokenHint}</span>
                {requireTokenLocked && (
                  <span className="block text-xs text-amber-700 mt-1">{dict.admin.lockedByEnv}</span>
                )}
              </span>
            </label>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? dict.admin.savingBtn : dict.admin.saveBtn}
          </Button>
        </div>
      </form>
    </div>
  );
}
