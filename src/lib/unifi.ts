import { Agent, fetch as undiciFetch } from "undici";

/**
 * Cliente HTTP minimalista para a controladora UniFi (v10.1.89, self-hosted).
 *
 * Mantém um cookie de sessão em memória e o reutiliza entre chamadas.
 * Sob 401 ou cookie expirado, faz relogin transparente.
 */

type UniFiSession = {
  cookieHeader: string;
  csrfToken?: string;
  expiresAt: number;
  isUnifiOS: boolean;
};

const SESSION_TTL_MS = 55 * 60 * 1000;

let cachedSession: UniFiSession | null = null;
let dispatcher: Agent | undefined;

function getDispatcher(): Agent {
  if (!dispatcher) {
    const insecure = process.env.UNIFI_INSECURE_TLS === "true";
    dispatcher = new Agent({
      connect: { rejectUnauthorized: !insecure },
    });
  }
  return dispatcher;
}

function baseUrl(): string {
  const url = process.env.UNIFI_URL;
  if (!url) throw new Error("UNIFI_URL não configurada");
  return url.replace(/\/$/, "");
}

function site(): string {
  return process.env.UNIFI_SITE || "default";
}

function parseSetCookie(header: string | null): string {
  if (!header) return "";
  // Cabeçalhos podem vir concatenados; pegamos pares chave=valor
  return header
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function login(): Promise<UniFiSession> {
  const username = process.env.UNIFI_USERNAME;
  const password = process.env.UNIFI_PASSWORD;
  if (!username || !password)
    throw new Error("UNIFI_USERNAME / UNIFI_PASSWORD não configurados");

  const commonHeaders: Record<string, string> = {
    "content-type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Origin": baseUrl(),
    "Referer": `${baseUrl()}/manage/account/login`,
  };

  const base = baseUrl();
  
  // Tenta primeiro login UniFi OS (mais moderno)
  let isUnifiOS = true;
  let res = await undiciFetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ username, password, remember: true }),
    dispatcher: getDispatcher(),
  });

  // Se falhar com 404, tenta login Classic
  if (res.status === 404) {
    isUnifiOS = false;
    res = await undiciFetch(`${base}/api/login`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({ username, password, remember: true }),
      dispatcher: getDispatcher(),
    });
  }

  // Se falhar no endpoint detectado (401/403), tenta o outro como fallback final
  if (!res.ok && (res.status === 401 || res.status === 403)) {
    const alternativeEndpoint = isUnifiOS ? "/api/login" : "/api/auth/login";
    console.log(`[UniFi] Falha no endpoint ${isUnifiOS ? 'OS' : 'Classic'}, tentando fallback para ${alternativeEndpoint}...`);
    
    const fallbackRes = await undiciFetch(`${base}${alternativeEndpoint}`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({ username, password, remember: true }),
      dispatcher: getDispatcher(),
    });

    if (fallbackRes.ok) {
      res = fallbackRes;
      isUnifiOS = !isUnifiOS;
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UniFi login falhou (${res.status}): ${text}`);
  }

  const cookieHeader = parseSetCookie(res.headers.get("set-cookie"));
  const csrfToken =
    res.headers.get("x-csrf-token") ?? res.headers.get("x-updated-csrf-token") ?? undefined;

  cachedSession = {
    cookieHeader,
    csrfToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
    isUnifiOS,
  };
  return cachedSession;
}

async function ensureSession(): Promise<UniFiSession> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession;
  return login();
}

async function unifiRequest<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const doFetch = async (session: UniFiSession) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Origin": baseUrl(),
      cookie: session.cookieHeader,
    };
    if (session.csrfToken) headers["x-csrf-token"] = session.csrfToken;

    const fullPath = session.isUnifiOS ? `/proxy/network${path}` : path;

    return undiciFetch(`${baseUrl()}${fullPath}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      dispatcher: getDispatcher(),
    });
  };

  let session = await ensureSession();
  let res = await doFetch(session);

  if (res.status === 401 || res.status === 403) {
    cachedSession = null;
    session = await login();
    res = await doFetch(session);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UniFi ${path} falhou (${res.status}): ${text}`);
  }

  // Atualiza CSRF rotativo, se enviado
  const newCsrf = res.headers.get("x-updated-csrf-token");
  if (newCsrf && cachedSession) cachedSession.csrfToken = newCsrf;

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type AuthorizeGuestOptions = {
  mac: string;
  minutes: number;
  upKbps?: number;
  downKbps?: number;
  bytesQuotaMB?: number;
  apMac?: string | null;
};

export async function authorizeGuest(opts: AuthorizeGuestOptions): Promise<void> {
  const payload: Record<string, unknown> = {
    cmd: "authorize-guest",
    mac: opts.mac.toLowerCase(),
    minutes: opts.minutes,
  };
  if (opts.upKbps) payload.up = opts.upKbps;
  if (opts.downKbps) payload.down = opts.downKbps;
  if (opts.bytesQuotaMB) payload.bytes = opts.bytesQuotaMB;
  if (opts.apMac) payload.ap_mac = opts.apMac.toLowerCase();

  await unifiRequest(`/api/s/${site()}/cmd/stamgr`, {
    method: "POST",
    body: payload,
  });
}

export async function unauthorizeGuest(mac: string): Promise<void> {
  await unifiRequest(`/api/s/${site()}/cmd/stamgr`, {
    method: "POST",
    body: { cmd: "unauthorize-guest", mac: mac.toLowerCase() },
  });
}

export type UniFiGuest = {
  mac: string;
  ap_mac?: string;
  essid?: string;
  ip?: string;
  hostname?: string;
  start?: number;
  end?: number;
  duration?: number;
  tx_bytes?: number;
  rx_bytes?: number;
  authorized?: boolean;
};

export async function listActiveGuests(): Promise<UniFiGuest[]> {
  const res = await unifiRequest<{ data: UniFiGuest[] }>(
    `/api/s/${site()}/stat/guest`,
  );
  return res.data ?? [];
}

export function clearUniFiSession(): void {
  cachedSession = null;
}
