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

/**
 * Exibe a chave de visitante (ver visitorKeyOf) sem expor o dado completo:
 * CPF mascarado, documento/e-mail parcialmente ocultos, MAC como está.
 */
export function maskVisitorKey(key: string): string {
  if (/^\d{11}$/.test(key)) return maskCpf(key);
  if (key.startsWith("doc:")) {
    const doc = key.slice(4);
    return `Doc ${"•".repeat(Math.max(0, doc.length - 3))}${doc.slice(-3)}`;
  }
  if (key.startsWith("email:")) {
    const [user, domain] = key.slice(6).split("@");
    return `${(user ?? "").slice(0, 2)}•••@${domain ?? ""}`;
  }
  if (key.startsWith("mac:")) return key.slice(4);
  return key;
}

/** Mascaramento de dados pessoais para quem só tem leitura (papel "viewer"). */
export function maskEmail(email: string): string {
  if (!email) return email;
  const [user, domain] = email.split("@");
  return `${(user ?? "").slice(0, 2)}•••@${domain ?? ""}`;
}

export function maskPhone(phone: string): string {
  if (!phone) return phone;
  return `•••••${phone.slice(-4)}`;
}

export function maskDocument(doc: string | null): string | null {
  if (!doc) return doc;
  return `${"•".repeat(Math.max(0, doc.length - 3))}${doc.slice(-3)}`;
}
