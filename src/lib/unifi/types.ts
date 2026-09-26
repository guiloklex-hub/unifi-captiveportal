/** Guest/cliente no formato da API legada (`/stat/guest`). Integração é mapeada para ele. */
export type UniFiGuest = {
  mac: string;
  ap_mac?: string;
  essid?: string;
  ip?: string;
  hostname?: string;
  /** epoch (s) do início da autorização */
  start?: number;
  /** epoch (s) do fim da autorização */
  end?: number;
  duration?: number;
  tx_bytes?: number;
  rx_bytes?: number;
  authorized?: boolean;
  expired?: boolean;
};

export type AuthorizeParams = {
  mac: string;
  minutes: number;
  upKbps?: number;
  downKbps?: number;
  bytesQuotaMB?: number;
  apMac?: string | null;
};

export type UniFiSite = {
  /** Nome curto usado na API legada (`default`, `abc123xy`). */
  name: string;
  description: string;
  /** ID da API oficial (UUID) ou `_id` legado, quando disponível. */
  id: string | null;
};

export type UniFiDevice = {
  mac: string;
  name: string;
  model: string | null;
};

/** Forma de falar com a controladora, em ordem de preferência por operação. */
export type UniFiStrategy = "integration" | "legacy-apikey" | "legacy-session";
