import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold">UniFi Captive Portal</h1>
      <p className="text-muted-foreground">Selecione uma área para continuar.</p>
      <div className="flex gap-4">
        <Link className="rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/portal">
          Portal Guest
        </Link>
        <Link className="rounded-md border px-4 py-2" href="/admin">
          Painel Admin
        </Link>
      </div>
    </main>
  );
}
