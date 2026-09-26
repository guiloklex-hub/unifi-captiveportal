import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Controladora UniFi simulada para testes do cliente. Cobre as variantes
 * Classic (self-hosted) e UniFi OS, a API legada e a API oficial (Integration).
 */
export type MockOptions = {
  variant: "classic" | "unifi-os";
  username?: string;
  password?: string;
  apiKey?: string;
  /** API oficial disponível (Network 9.3+ no UniFi OS). */
  integration?: boolean;
  /** API legada aceita X-API-KEY (UniFi OS recente). */
  legacyAcceptsApiKey?: boolean;
  /** Suporta `?filter=` na listagem de clientes da API oficial. */
  integrationFilter?: boolean;
  version?: string;
};

export type RecordedCall = { method: string; path: string; body: unknown; headers: IncomingMessage["headers"] };

const SITE_ID = "88f7af54-98f8-306a-a1c7-c9349722b1f6";
const CLIENT_ID = "c1a2b3c4-0000-4000-8000-000000000001";

export class MockUnifi {
  calls: RecordedCall[] = [];
  guests = [
    { mac: "aa:bb:cc:dd:ee:ff", ip: "10.0.0.10", essid: "Guest", tx_bytes: 1000, rx_bytes: 2000, authorized: true },
  ];
  /** Força a próxima chamada autenticada a devolver 401 (sessão expirada). */
  expireSessionOnce = false;
  private server: Server;
  private sessions = new Set<string>();
  url = "";
  private opts: MockOptions;

  // Sem "parameter properties" para rodar direto no Node (type stripping).
  constructor(opts: MockOptions) {
    this.opts = opts;
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async start(port = 0): Promise<string> {
    await new Promise<void>((r) => this.server.listen(port, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  callsTo(fragment: string): RecordedCall[] {
    return this.calls.filter((c) => c.path.includes(fragment));
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    this.calls.push({ method: req.method ?? "GET", path: `${path}${url.search}`, body, headers: req.headers });

    const isOS = this.opts.variant === "unifi-os";

    if (path === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html", ...(isOS ? { "x-csrf-token": "csrf-1" } : {}) });
      return res.end("<html>UniFi</html>");
    }

    const loginPath = isOS ? "/api/auth/login" : "/api/login";
    if (path === loginPath && req.method === "POST") {
      const b = body as { username?: string; password?: string };
      if (b?.username !== this.opts.username || b?.password !== this.opts.password) {
        return this.json(res, isOS ? 401 : 400, { meta: { rc: "error", msg: "api.err.Invalid" } });
      }
      const sid = `s${Math.random().toString(36).slice(2)}`;
      this.sessions.add(sid);
      return this.json(res, 200, { meta: { rc: "ok" }, data: [] }, {
        "set-cookie": `${isOS ? "TOKEN" : "unifises"}=${sid}; Path=/; HttpOnly`,
        ...(isOS ? { "x-csrf-token": "csrf-2" } : {}),
      });
    }

    // ── API oficial ──
    const integrationPrefix = "/proxy/network/integration/v1";
    if (path.startsWith("/integration/") || path.startsWith(integrationPrefix)) {
      if (!isOS || !this.opts.integration || !path.startsWith(integrationPrefix)) {
        return this.json(res, 404, { error: "not found" });
      }
      if (req.headers["x-api-key"] !== this.opts.apiKey) return this.json(res, 401, { message: "Unauthorized" });
      const sub = path.slice(integrationPrefix.length);
      if (sub === "/info") return this.json(res, 200, { applicationVersion: this.opts.version ?? "9.4.19" });
      if (sub === "/sites") {
        return this.json(res, 200, {
          offset: 0, limit: 25, count: 1, totalCount: 1,
          data: [{ id: SITE_ID, internalReference: "default", name: "Default" }],
        });
      }
      if (sub === `/sites/${SITE_ID}/clients`) {
        if (url.searchParams.has("filter") && !this.opts.integrationFilter) {
          return this.json(res, 400, { message: "filter not supported" });
        }
        const data = this.guests.map((gst, i) => ({
          id: i === 0 ? CLIENT_ID : `other-${i}`,
          name: `guest-${i}`,
          type: "WIRELESS",
          macAddress: gst.mac,
          ipAddress: gst.ip,
          connectedAt: "2026-09-26T10:00:00Z",
          access: { type: "GUEST", authorized: gst.authorized },
        }));
        const filter = url.searchParams.get("filter");
        const filtered = filter ? data.filter((d) => filter.includes(d.macAddress)) : data;
        return this.json(res, 200, { offset: 0, limit: 200, count: filtered.length, totalCount: filtered.length, data: filtered });
      }
      if (sub === `/sites/${SITE_ID}/clients/${CLIENT_ID}/actions` && req.method === "POST") {
        return this.json(res, 200, { action: (body as { action: string }).action });
      }
      if (sub === `/sites/${SITE_ID}/devices`) {
        return this.json(res, 200, { data: [{ macAddress: "11:22:33:44:55:66", name: "AP Recepção", model: "U7PG2" }], totalCount: 1 });
      }
      return this.json(res, 404, { error: "not found" });
    }

    // ── API legada ──
    const legacyPrefix = isOS ? "/proxy/network" : "";
    if (!path.startsWith(`${legacyPrefix}/api/`)) return this.json(res, 404, { error: "not found" });
    const sub = path.slice(legacyPrefix.length);

    const apiKeyOk = isOS && this.opts.legacyAcceptsApiKey && req.headers["x-api-key"] === this.opts.apiKey;
    const cookie = req.headers.cookie ?? "";
    const sid = /(?:TOKEN|unifises)=([^;]+)/.exec(cookie)?.[1];
    let sessionOk = Boolean(sid && this.sessions.has(sid));
    if (sessionOk && this.expireSessionOnce) {
      this.expireSessionOnce = false;
      this.sessions.delete(sid!);
      sessionOk = false;
    }
    if (!apiKeyOk && !sessionOk) return this.json(res, 401, { meta: { rc: "error", msg: "api.err.LoginRequired" } });

    if (sub === "/api/self/sites") return this.json(res, 200, { data: [{ name: "default", desc: "Default", _id: "abc" }] });
    if (/^\/api\/s\/[^/]+\/stat\/sysinfo$/.test(sub)) return this.json(res, 200, { data: [{ version: this.opts.version ?? "10.1.89" }] });
    if (/^\/api\/s\/[^/]+\/stat\/guest$/.test(sub)) return this.json(res, 200, { data: this.guests });
    if (/^\/api\/s\/[^/]+\/stat\/sta$/.test(sub)) {
      return this.json(res, 200, { data: this.guests.map((gst) => ({ mac: gst.mac, ip: gst.ip })) });
    }
    if (/^\/api\/s\/[^/]+\/stat\/device-basic$/.test(sub)) {
      return this.json(res, 200, { data: [{ mac: "11:22:33:44:55:66", name: "AP Recepção", model: "U7PG2" }] });
    }
    if (/^\/api\/s\/[^/]+\/cmd\/stamgr$/.test(sub) && req.method === "POST") {
      return this.json(res, 200, { meta: { rc: "ok" }, data: [] });
    }
    return this.json(res, 404, { error: "not found" });
  }
}

export const MOCK_SITE_ID = SITE_ID;
export const MOCK_CLIENT_ID = CLIENT_ID;
