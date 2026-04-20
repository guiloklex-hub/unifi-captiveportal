// Serviço para comunicação com a API do AdGuard Home.

export interface AdGuardLogEntry {
  answer: any[];
  client: string;
  client_id: string;
  client_info: {
    name: string;
    ip: string;
    whois: any;
  };
  cp: string;
  elapsedMs: string;
  question: {
    class: string;
    name: string;
    type: string;
  };
  reason: string;
  status: string;
  time: string;
  upstream: string;
}

export interface AdGuardQueryLogResponse {
  data: AdGuardLogEntry[];
  oldest_time: string;
}

/**
 * Busca logs de consulta DNS no AdGuard Home para um IP específico.
 */
export async function getAdGuardLogs(ip: string, limit: number = 50): Promise<AdGuardLogEntry[]> {
  const url = process.env.ADGUARD_URL;
  const user = process.env.ADGUARD_USER;
  const pass = process.env.ADGUARD_PASSWORD;

  if (!url || !user || !pass) {
    throw new Error("AdGuard Home configuration missing in environment variables.");
  }

  // Remove trailing slash from URL if present
  const baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;
  const apiUrl = `${baseUrl}/control/querylog?search=${encodeURIComponent(ip)}&limit=${limit}`;

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      cache: "no-store", // Garantir logs em tempo real
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AdGuard API Error:", errorText);
      throw new Error(`Failed to fetch logs from AdGuard Home: ${response.statusText}`);
    }

    const result: AdGuardQueryLogResponse = await response.json();
    return result.data || [];
  } catch (error) {
    console.error("Error connecting to AdGuard Home:", error);
    throw error;
  }
}
