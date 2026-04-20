"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, ShieldCheck, ShieldAlert, ExternalLink } from "lucide-react";
import { Dictionary } from "@/lib/i18n/dictionaries";
import { AdGuardLogEntry } from "@/lib/adguard";

interface ActivityDialogProps {
  ip: string;
  name: string;
  dict: Dictionary;
}

export function ActivityDialog({ ip, name, dict }: ActivityDialogProps) {
  const [logs, setLogs] = useState<AdGuardLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/dns-logs?ip=${encodeURIComponent(ip)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || dict.admin.connError);
      }
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.admin.connError);
    } finally {
      setLoading(false);
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      fetchLogs();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={dict.admin.viewActivityBtn}>
          <Activity className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            {dict.admin.activityTitle}: {name || ip}
          </DialogTitle>
          <DialogDescription>
            {dict.admin.activityDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto mt-4 border rounded-md">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{dict.admin.loading}</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={fetchLogs}>
                Tentar novamente
              </Button>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-20 text-center text-muted-foreground">
              {dict.admin.noActivity}
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background shadow-sm">
                <TableRow>
                  <TableHead>{dict.admin.tableDomain}</TableHead>
                  <TableHead className="w-[120px]">{dict.admin.tableStatus}</TableHead>
                  <TableHead className="w-[100px]">{dict.admin.tableTime}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((entry, i) => {
                  const isBlocked = entry.reason && entry.reason !== "NotFilteredNotFound";
                  const time = new Date(entry.time).toLocaleTimeString();
                  
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium max-w-[400px] truncate">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{entry.question.name}</span>
                          <a 
                            href={`https://${entry.question.name}`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-primary"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isBlocked ? (
                          <div className="flex items-center gap-1.5 text-destructive font-medium text-xs">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {dict.admin.statusBlocked}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-xs">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {dict.admin.statusAllowed}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {time}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
