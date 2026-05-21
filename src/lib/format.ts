export function formatBytes(value: bigint | number | null | undefined, locale: "pt" | "en" | "es" = "pt"): string {
  const n = value == null ? 0 : typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let val = n;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  const intl = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";
  const fmt = val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2);
  return `${Number(fmt).toLocaleString(intl)} ${units[i]}`;
}

export function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9, 11)}`;
}

export function bigIntToNumber(value: bigint | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}
