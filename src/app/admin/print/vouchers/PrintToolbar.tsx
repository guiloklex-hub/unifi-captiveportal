"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export function PrintToolbar({ ssid, count, dict }: { ssid: string; count: number; dict: Dictionary }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(ssid);

  const applySsid = () => {
    const sp = new URLSearchParams(params.toString());
    if (value.trim()) sp.set("ssid", value.trim());
    else sp.delete("ssid");
    router.replace(`?${sp.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-white p-3 print:hidden">
      <span className="text-sm text-muted-foreground">{count} vouchers</span>
      <Input
        aria-label={dict.admin.voucherNetwork}
        className="h-9 max-w-64"
        placeholder={dict.admin.voucherSsidPlaceholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={applySsid}
        onKeyDown={(e) => e.key === "Enter" && applySsid()}
      />
      <Button className="ml-auto" onClick={() => window.print()} disabled={count === 0}>
        {dict.admin.printBtn}
      </Button>
    </div>
  );
}
