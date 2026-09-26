/**
 * Erros do cliente UniFi. A distinção importa para o fallback entre estratégias
 * de conexão e para a mensagem exibida ao guest.
 */

/** Controladora inalcançável (rede, timeout, 5xx após retries) ou circuit breaker aberto. */
export class UniFiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniFiUnavailableError";
  }
}

/**
 * Controladora respondeu recusando o request (4xx ≠ 401/403/404). Não retriável e
 * **não conta** para o circuit breaker — ela está viva, só recusou o payload.
 */
export class UniFiClientError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UniFiClientError";
    this.status = status;
  }
}

/** Credenciais (usuário/senha ou API Key) recusadas pela controladora. */
export class UniFiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniFiAuthError";
  }
}

/** Endpoint/estratégia inexistente nesta controladora (ex.: API oficial em versão antiga). */
export class UniFiNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniFiNotSupportedError";
  }
}

/** Nenhuma forma de conexão configurada (sem API Key e sem usuário/senha). */
export class UniFiNotConfiguredError extends Error {
  constructor(message = "Conexão UniFi não configurada (defina UNIFI_API_KEY ou UNIFI_USERNAME/UNIFI_PASSWORD)") {
    super(message);
    this.name = "UniFiNotConfiguredError";
  }
}
