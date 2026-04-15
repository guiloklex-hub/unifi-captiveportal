import Link from "next/link";
import { LayoutDashboard, ListOrdered, Wifi, LogOut, Palette } from "lucide-react";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/logs", label: "Logs", icon: ListOrdered },
  { href: "/admin/sessions", label: "Sessões", icon: Wifi },
  { href: "/admin/settings", label: "Customização", icon: Palette },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 flex-col border-r bg-white p-6 md:flex">
        <div className="mb-8">
          <h2 className="text-lg font-bold">UniFi Portal</h2>
          <p className="text-xs text-muted-foreground">Painel administrativo</p>
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
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </form>
      </aside>
      <main className="flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
