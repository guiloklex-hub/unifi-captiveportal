"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QrCode, Loader2, Download } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries";

interface TokenQrDialogProps {
  tokenId: string;
  code: string;
  dict: Dictionary;
}

export function TokenQrDialog({ tokenId, code, dict }: TokenQrDialogProps) {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/tokens/${tokenId}/qr`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const link = res.headers.get("x-token-deeplink");
        const text = await res.text();
        if (cancelled) return;
        setSvg(text);
        setDeepLink(link);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tokenId]);

  const download = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `token-${code}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title={dict.admin.tokenQrTitle}>
          <QrCode className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            {dict.admin.tokenQrTitle}
          </DialogTitle>
          <DialogDescription>{dict.admin.tokenQrHint}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 mt-2">
          {loading && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground my-12" />}
          {error && (
            <div className="text-destructive text-sm py-8">{error}</div>
          )}
          {svg && !loading && !error && (
            <>
              <div
                className="bg-white p-4 rounded-md border w-full max-w-[280px] aspect-square flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <code className="rounded-md bg-muted px-3 py-1.5 text-sm font-mono tracking-wider">
                {code}
              </code>
              {deepLink && (
                <p className="text-xs text-muted-foreground text-center break-all px-2">
                  {deepLink}
                </p>
              )}
              <Button onClick={download} variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                {dict.admin.tokenQrDownload}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
