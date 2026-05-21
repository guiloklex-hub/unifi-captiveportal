export type DeviceKind = "mobile" | "tablet" | "desktop" | "unknown";

export type UAInfo = {
  os: string;
  browser: string;
  device: DeviceKind;
};

const UNKNOWN: UAInfo = { os: "Desconhecido", browser: "Desconhecido", device: "unknown" };

export function parseUserAgent(ua: string | null | undefined): UAInfo {
  if (!ua || typeof ua !== "string") return UNKNOWN;

  const s = ua.toLowerCase();

  let os = "Outros";
  if (/iphone|ipad|ipod/.test(s)) os = "iOS";
  else if (/android/.test(s)) os = "Android";
  else if (/windows nt 10\.0/.test(s)) os = "Windows 10/11";
  else if (/windows nt/.test(s)) os = "Windows";
  else if (/mac os x/.test(s)) os = "macOS";
  else if (/cros/.test(s)) os = "ChromeOS";
  else if (/linux/.test(s)) os = "Linux";

  let browser = "Outros";
  if (/edg\//.test(s)) browser = "Edge";
  else if (/opr\/|opera/.test(s)) browser = "Opera";
  else if (/samsungbrowser/.test(s)) browser = "Samsung Internet";
  else if (/firefox/.test(s)) browser = "Firefox";
  else if (/fxios/.test(s)) browser = "Firefox";
  else if (/crios/.test(s)) browser = "Chrome";
  else if (/chrome\//.test(s) && !/edg\/|opr\//.test(s)) browser = "Chrome";
  else if (/safari/.test(s) && !/chrome|crios|fxios|edg\/|opr\//.test(s)) browser = "Safari";

  let device: DeviceKind = "desktop";
  if (/ipad|tablet|playbook|silk/.test(s)) device = "tablet";
  else if (/mobile|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini/.test(s)) device = "mobile";
  else if (/android/.test(s) && !/mobile/.test(s)) device = "tablet";

  return { os, browser, device };
}

export function deviceKindLabel(kind: DeviceKind, locale: "pt" | "en" | "es"): string {
  const map: Record<"pt" | "en" | "es", Record<DeviceKind, string>> = {
    pt: { mobile: "Celular", tablet: "Tablet", desktop: "Desktop", unknown: "Desconhecido" },
    en: { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop", unknown: "Unknown" },
    es: { mobile: "Móvil", tablet: "Tablet", desktop: "Escritorio", unknown: "Desconocido" },
  };
  return map[locale][kind];
}
