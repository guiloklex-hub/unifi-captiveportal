import { Agent, fetch as undiciFetch } from "undici";
import { logger } from "./logger";

/**
 * Cliente HTTP para controladora UniFi (self-hosted ou UniFi OS).
 *
 * - Timeouts de protocolo e por requisição (evita travamento quando a controladora
 *   fica lenta — causa documentada do incidente de 23/04/2026 às 09:07).
 * - Retry com backoff para falhas transientes (5xx, aborts, erros de rede).
 * - Mutex de login para evitar relogin concorrente.
 * - Circuit breaker: após N falhas seguidas, rejeita requests por um período.
 * - Detecção OS/Classic por probe (antes de usar credenciais).
 * - Validação de content-type JSON (detecta sessão invalidada que retorna HTML).
 */

type UniFiSession = {
  cookieHeader: string;
  csrfToken?: string;
  expiresAt: number;
  isUnifiOS: boolean;
};

const SESSION_TTL_MS = 55 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const LOGIN_TIMEOUT_MS = 10_000;
const RETRY_MAX = 2;
const RETRY_BASE_MS = 500;

// Circuit breaker
const CB_FAILURE_THRESHOLD = 5;
const CB_OPEN_MS = 30_000;

let cachedSession: UniFiSession | null = null;
let loginPromise: Promise<UniFiSession> | null = null;
let detectedIsUnifiOS: boolean | null = null;
let dispatcher: Agent | undefined;

let cbFailureCount = 0;
let cbOpenUntil = 0;

class UniFiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniFiUnavailableError";
  }
}

function getDispatcher(): Agent {
  if (!dispatcher) {
    const insecure = process.env.UNIFI_INSECURE_TLS === "true";
    dispatcher = new Agent({
      connect: { rejectUnauthorized: !insecure, timeout: 5_000 },
      bodyTimeout: 15_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
  }
  return dispatcher;
}

function baseUrl(): string {
  const url = process.env.UNIFI_URL;
  if (!url) throw new Error("UNIFI_URL não configurada");
  return url.replace(/\/$/, "");
}

function defaultSite(): string {
  return process.env.UNIFI_SITE || "default";
}

function resolveSite(site?: string | null): string {
  const s = (site ?? "").trim();
  return s.length > 0 ? s : defaultSite();
}

function parseSetCookie(header: string | null): string {
  if (!header) return "";
  return header
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function isJsonResponse(res: { headers: { get(name: string): string | null } }): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return ct.toLowerCase().includes("application/json");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function checkCircuit(): void {
  if (cbOpenUntil > Date.now()) {
    throw new UniFiUnavailableError(
      `UniFi circuit open (aguarde ${Math.ceil((cbOpenUntil - Date.now()) / 1000)}s)`,
    );
  }
}

function recordSuccess(): void {
  if (cbFailureCount > 0) {
    logger.info({ cbFailureCount }, "UniFi circuit recovered");
  }
  cbFailureCount = 0;
  cbOpenUntil = 0;
}

function recordFailure(err: unknown): void {
  cbFailureCount += 1;
  if (cbFailureCount >= CB_FAILURE_THRESHOLD) {
    cbOpenUntil = Date.now() + CB_OPEN_MS;
    logger.error(
      { failures: cbFailureCount, openMs: CB_OPEN_MS, err: (err as Error)?.message },
      "UniFi circuit opened",
    );
  }
}

/**
 * Probe leve para detectar se é UniFi OS (v7+) ou Classic.
 * UniFi OS responde com X-CSRF-Token no GET raiz; Classic não.
 */
async function detectIsUnifiOS(): Promise<boolean> {
  if (detectedIsUnifiOS !== null) return detectedIsUnifiOS;

  try {
    const res = await undiciFetch(`${baseUrl()}/`, {
      method: "GET",
      dispatcher: getDispatcher(),
      signal: AbortSignal.timeout(5_000),
    });
    // UniFi OS sempre devolve X-CSRF-Token no GET raiz
    detectedIsUnifiOS = res.headers.get("x-csrf-token") !== null;
    logger.debug({ isUnifiOS: detectedIsUnifiOS }, "UniFi variant detected");
    return detectedIsUnifiOS;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "UniFi variant probe failed, assuming Classic");
    // Não persiste detecção em erro — tenta de novo na próxima
    return false;
  }
}

async function doLogin(): Promise<UniFiSession> {
  const username = process.env.UNIFI_USERNAME;
  const password = process.env.UNIFI_PASSWORD;
  if (!username || !password)
    throw new Error("UNIFI_USERNAME / UNIFI_PASSWORD não configurados");

  const commonHeaders: Record<string, string> = {
    "content-type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Origin: baseUrl(),
    Referer: `${baseUrl()}/manage/account/login`,
  };

  const isUnifiOS = await detectIsUnifiOS();
  const primary = isUnifiOS ? "/api/auth/login" : "/api/login";
  const fallback = isUnifiOS ? "/api/login" : "/api/auth/login";

  const attempt = async (endpoint: string) =>
    undiciFetch(`${baseUrl()}${endpoint}`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({ username, password, remember: true }),
      dispatcher: getDispatcher(),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });

  let res = await attempt(primary);
  let usedIsUnifiOS = isUnifiOS;

  // Se o endpoint primário retornar 404 (variante errada detectada por HTTP), tenta o outro
  if (res.status === 404) {
    logger.warn({ primary, fallback }, "UniFi primary endpoint 404, trying fallback");
    res = await attempt(fallback);
    usedIsUnifiOS = !isUnifiOS;
    if (res.ok) {
      // Corrige a detecção persistida
      detectedIsUnifiOS = usedIsUnifiOS;
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UniFi login falhou (${res.status}): ${text.slice(0, 200)}`);
  }

  const cookieHeader = parseSetCookie(res.headers.get("set-cookie"));
  const csrfToken =
    res.headers.get("x-csrf-token") ?? res.headers.get("x-updated-csrf-token") ?? undefined;

  const session: UniFiSession = {
    cookieHeader,
    csrfToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
    isUnifiOS: usedIsUnifiOS,
  };
  cachedSession = session;
  logger.info({ isUnifiOS: usedIsUnifiOS, hasCsrf: !!csrfToken }, "UniFi login ok");
  return session;
}

/**
 * Login com mutex: requests simultâneos aguardam a mesma promise.
 */
async function login(): Promise<UniFiSession> {
  if (loginPromise) return loginPromise;
  loginPromise = doLogin().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

async function ensureSession(): Promise<UniFiSession> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession;
  return login();
}

type UnifiRequestInit = { method?: "GET" | "POST"; body?: unknown };

async function unifiFetchOnce<T>(
  path: string,
  init: UnifiRequestInit,
  session: UniFiSession,
): Promise<{ ok: boolean; status: number; data?: T; text?: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Origin: baseUrl(),
    cookie: session.cookieHeader,
  };
  if (session.csrfToken) headers["x-csrf-token"] = session.csrfToken;

  const fullPath = session.isUnifiOS ? `/proxy/network${path}` : path;

  const res = await undiciFetch(`${baseUrl()}${fullPath}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    dispatcher: getDispatcher(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // CSRF rotativo
  const newCsrf = res.headers.get("x-updated-csrf-token");
  if (newCsrf && cachedSession) cachedSession.csrfToken = newCsrf;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, text };
  }

  if (res.status === 204) return { ok: true, status: 204, data: undefined };

  // Defesa contra sessão invalidada retornando HTML da tela de login com status 200
  if (!isJsonResponse(res)) {
    const text = await res.text().catch(() => "");
    logger.warn(
      { path, status: res.status, preview: text.slice(0, 120) },
      "UniFi returned non-JSON on success — invalidating session",
    );
    cachedSession = null;
    return { ok: false, status: 401, text: "non-json response" };
  }

  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data };
}

async function unifiRequest<T = unknown>(
  path: string,
  init: UnifiRequestInit = {},
): Promise<T> {
  checkCircuit();

  const correlationId = Math.random().toString(36).slice(2, 10);
  const started = Date.now();
  const log = logger.child({ correlationId, path, method: init.method ?? "GET" });
  log.debug("UniFi request start");

  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      let session = await ensureSession();
      let resp = await unifiFetchOnce<T>(path, init, session);

      // Relogin transparente em 401/403 (sessão expirada ou cookie revogado)
      if (!resp.ok && (resp.status === 401 || resp.status === 403)) {
        cachedSession = null;
        session = await login();
        resp = await unifiFetchOnce<T>(path, init, session);
      }

      if (resp.ok) {
        recordSuccess();
        log.info({ status: resp.status, ms: Date.now() - started, attempt }, "UniFi request ok");
        return resp.data as T;
      }

      // 4xx (exceto 401/403) não são retriáveis: erro do cliente/payload
      if (resp.status < 500 && resp.status !== 0) {
        throw new Error(
          `UniFi ${path} falhou (${resp.status}): ${(resp.text ?? "").slice(0, 200)}`,
        );
      }

      lastErr = new Error(`UniFi ${path} status ${resp.status}`);
    } catch (err) {
      lastErr = err;
      const name = (err as Error)?.name;
      const isRetryable =
        name === "AbortError" ||
        name === "TimeoutError" ||
        name === "TypeError" ||
        (err instanceof Error && /UniFi .* status 5\d{2}/.test(err.message));
      if (!isRetryable) {
        recordFailure(err);
        throw err;
      }
    }

    if (attempt < RETRY_MAX) {
      const delay = RETRY_BASE_MS * Math.pow(3, attempt); // 500ms, 1500ms
      log.warn({ attempt: attempt + 1, delay, err: (lastErr as Error)?.message }, "UniFi retry");
      await sleep(delay);
    }
  }

  recordFailure(lastErr);
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  log.error({ ms: Date.now() - started, err: message }, "UniFi request exhausted retries");
  throw new Error(`UniFi ${path} indisponível após ${RETRY_MAX + 1} tentativas: ${message}`);
}

export type AuthorizeGuestOptions = {
  mac: string;
  minutes: number;
  upKbps?: number;
  downKbps?: number;
  bytesQuotaMB?: number;
  apMac?: string | null;
  site?: string | null;
};

export async function authorizeGuest(opts: AuthorizeGuestOptions): Promise<void> {
  const payload: Record<string, unknown> = {
    cmd: "authorize-guest",
    mac: opts.mac.toLowerCase(),
    minutes: opts.minutes,
  };
  // Why: `0` é valor inválido para limites no UniFi (sinônimo de ausente);
  // só inclui no payload quando há limite real (> 0).
  if (typeof opts.upKbps === "number" && opts.upKbps > 0) payload.up = opts.upKbps;
  if (typeof opts.downKbps === "number" && opts.downKbps > 0) payload.down = opts.downKbps;
  if (typeof opts.bytesQuotaMB === "number" && opts.bytesQuotaMB > 0) payload.bytes = opts.bytesQuotaMB;
  if (opts.apMac) payload.ap_mac = opts.apMac.toLowerCase();

  await unifiRequest(`/api/s/${resolveSite(opts.site)}/cmd/stamgr`, {
    method: "POST",
    body: payload,
  });
}

export async function unauthorizeGuest(mac: string, siteOverride?: string | null): Promise<void> {
  await unifiRequest(`/api/s/${resolveSite(siteOverride)}/cmd/stamgr`, {
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

export async function listActiveGuests(siteOverride?: string | null): Promise<UniFiGuest[]> {
  const res = await unifiRequest<{ data: UniFiGuest[] }>(
    `/api/s/${resolveSite(siteOverride)}/stat/guest`,
  );
  return res.data ?? [];
}

export function clearUniFiSession(): void {
  cachedSession = null;
}

export type UniFiHealth = {
  status: "ok" | "degraded" | "down";
  circuitOpenUntil: number | null;
  cachedSessionValid: boolean;
  failures: number;
};

export async function checkUnifiHealth(): Promise<UniFiHealth> {
  const cachedSessionValid = !!(cachedSession && cachedSession.expiresAt > Date.now());
  const circuitOpen = cbOpenUntil > Date.now();

  if (circuitOpen) {
    return {
      status: "down",
      circuitOpenUntil: cbOpenUntil,
      cachedSessionValid,
      failures: cbFailureCount,
    };
  }

  try {
    await Promise.race([
      ensureSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("healthz timeout")), 3_000),
      ),
    ]);
    return {
      status: "ok",
      circuitOpenUntil: null,
      cachedSessionValid: true,
      failures: cbFailureCount,
    };
  } catch {
    return {
      status: "degraded",
      circuitOpenUntil: null,
      cachedSessionValid,
      failures: cbFailureCount,
    };
  }
}

export { UniFiUnavailableError };
