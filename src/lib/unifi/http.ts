import { Agent, fetch as undiciFetch } from "undici";
import { logger } from "../logger";
import { UniFiUnavailableError } from "./errors";
import { networkErrorDetail } from "./netDiagnostics";

/**
 * Transporte HTTP compartilhado pelas estratégias de conexão UniFi:
 *  - timeouts de conexão/requisição (incidente de 23/04/2026 — controladora lenta);
 *  - retry com backoff para falhas transientes (rede, timeout, 5xx);
 *  - circuit breaker: após N falhas seguidas, rejeita requests por um período.
 *
 * Estado em globalThis para ser único no processo (cada rota do Next tem seu bundle).
 */

export const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_MAX = 2;
const RETRY_BASE_MS = 500;
const CB_FAILURE_THRESHOLD = 5;
const CB_OPEN_MS = 30_000;

type HttpState = {
  dispatchers: Map<string, Agent>;
  cbFailureCount: number;
  cbOpenUntil: number;
};

const g = globalThis as unknown as { __unifiHttp?: HttpState };
const state: HttpState = (g.__unifiHttp ??= {
  dispatchers: new Map(),
  cbFailureCount: 0,
  cbOpenUntil: 0,
});

export function getDispatcher(insecureTls: boolean): Agent {
  const key = insecureTls ? "insecure" : "strict";
  let d = state.dispatchers.get(key);
  if (!d) {
    d = new Agent({
      connect: { rejectUnauthorized: !insecureTls, timeout: 5_000 },
      bodyTimeout: 15_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
    state.dispatchers.set(key, d);
  }
  return d;
}

export function checkCircuit(): void {
  if (state.cbOpenUntil > Date.now()) {
    throw new UniFiUnavailableError(
      `UniFi circuit open (aguarde ${Math.ceil((state.cbOpenUntil - Date.now()) / 1000)}s)`,
    );
  }
}

export function recordSuccess(): void {
  if (state.cbFailureCount > 0) logger.info({ cbFailureCount: state.cbFailureCount }, "UniFi circuit recovered");
  state.cbFailureCount = 0;
  state.cbOpenUntil = 0;
}

export function recordFailure(err: unknown): void {
  state.cbFailureCount += 1;
  if (state.cbFailureCount >= CB_FAILURE_THRESHOLD) {
    state.cbOpenUntil = Date.now() + CB_OPEN_MS;
    logger.error(
      { failures: state.cbFailureCount, openMs: CB_OPEN_MS, err: (err as Error)?.message },
      "UniFi circuit opened",
    );
  }
}

export function circuitState(): { failures: number; openUntil: number | null } {
  return {
    failures: state.cbFailureCount,
    openUntil: state.cbOpenUntil > Date.now() ? state.cbOpenUntil : null,
  };
}

/** Só para testes. */
export function resetCircuit(): void {
  state.cbFailureCount = 0;
  state.cbOpenUntil = 0;
}

export type HttpResponse = {
  status: number;
  headers: { get(name: string): string | null; getSetCookie(): string[] };
  text: string;
  /** JSON parseado quando o content-type é JSON; `undefined` caso contrário. */
  json?: unknown;
};

export type HttpRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  insecureTls: boolean;
  timeoutMs?: number;
  /**
   * Teste de conexão do painel: não consulta nem alimenta o circuit breaker e
   * não repete tentativas (resposta rápida para o admin).
   */
  noCircuit?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransient(err: unknown): boolean {
  const name = (err as Error)?.name;
  return name === "AbortError" || name === "TimeoutError" || name === "TypeError";
}

async function once(url: string, req: HttpRequest): Promise<HttpResponse> {
  const res = await undiciFetch(url, {
    method: req.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
      ...req.headers,
    },
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    dispatcher: getDispatcher(req.insecureTls),
    signal: AbortSignal.timeout(req.timeoutMs ?? REQUEST_TIMEOUT_MS),
    redirect: "manual",
  });
  const text = res.status === 204 ? "" : await res.text().catch(() => "");
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  let json: unknown;
  if (ct.includes("application/json") && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { status: res.status, headers: res.headers, text, json };
}

/**
 * Executa o request com retry (rede/timeout/5xx) e circuit breaker. Respostas
 * 2xx–4xx são devolvidas ao chamador (a controladora está viva). Esgotadas as
 * tentativas, lança UniFiUnavailableError.
 */
export async function unifiHttp(url: string, req: HttpRequest): Promise<HttpResponse> {
  const track = !req.noCircuit;
  const maxRetries = track ? RETRY_MAX : 0;
  if (track) checkCircuit();
  const path = safePath(url);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const started = Date.now();
    try {
      const res = await once(url, req);
      if (res.status < 500) {
        if (track) recordSuccess();
        logger.debug({ path, status: res.status, ms: Date.now() - started, attempt }, "UniFi request");
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (!isTransient(err)) {
        if (track) recordFailure(err);
        throw new UniFiUnavailableError(`UniFi ${path}: ${networkErrorDetail(err)}`);
      }
      lastErr = err;
    }
    if (attempt < maxRetries) {
      const delay = RETRY_BASE_MS * Math.pow(3, attempt); // 500ms, 1500ms
      logger.warn({ path, attempt: attempt + 1, delay, err: networkErrorDetail(lastErr) }, "UniFi retry");
      await sleep(delay);
    }
  }

  if (track) recordFailure(lastErr);
  const message = networkErrorDetail(lastErr);
  logger.error({ path, err: message }, "UniFi request exhausted retries");
  throw new UniFiUnavailableError(`UniFi ${path} indisponível após ${maxRetries + 1} tentativa(s): ${message}`);
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
