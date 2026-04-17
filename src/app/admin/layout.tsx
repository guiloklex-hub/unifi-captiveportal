import Link from "next/link";
import { LayoutDashboard, ListOrdered, Wifi, LogOut, Palette } from "lucide-react";
import { headers } from "next/headers";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const locale = getLocale(headersList.get("accept-language"));
  const dict = dictionaries[locale];

  const navItems = [
    { href: "/admin", label: dict.admin.navDashboard, icon: LayoutDashboard },
    { href: "/admin/logs", label: dict.admin.navLogs, icon: ListOrdered },
    { href: "/admin/sessions", label: dict.admin.navSessions, icon: Wifi },
    { href: "/admin/settings", label: dict.admin.navSettings, icon: Palette },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 flex-col border-r bg-white p-6 md:flex">
        <div className="mb-8">
          <h2 className="text-lg font-bold">UniFi Portal</h2>
          <p className="text-xs text-muted-foreground">{dict.admin.adminSubtitle}</p>
        </div>
        <nav className="flex-1 space-y-1">
          {navItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </Link>
          ))}
        </nav>
        <form action="/api/admin/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" /> {dict.admin.navLogout}
          </button>
        </form>
      </aside>
      <main className="flex flex-1 flex-col min-w-0">
        <header className="flex items-center gap-4 overflow-x-auto border-b bg-white px-4 py-3 md:hidden sticky top-0 z-50">
          <div className="font-bold shrink-0 mr-2">Admin</div>
          <nav className="flex items-center gap-4 flex-1">
            {navItems.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="flex items-center gap-1 text-sm font-medium text-slate-700 whitespace-nowrap"
              >
                <it.icon className="h-4 w-4" />
                {it.label}
              </Link>
            ))}
          </nav>
          <form action="/api/admin/logout" method="post" className="shrink-0 ml-auto pl-4 border-l">
            <button type="submit" className="text-sm font-medium text-destructive whitespace-nowrap">
              {dict.admin.navLogout}
            </button>
          </form>
        </header>
        <div className="flex-1 p-4 md:p-10">{children}</div>
      </main>
    </div>
  );
}
