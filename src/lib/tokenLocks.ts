/**
 * Locks de configuração para tokens via variáveis de ambiente. Quando uma
 * variável está definida, o campo correspondente fica travado no painel admin
 * e seu valor é forçado em qualquer token criado / no toggle de exigir token.
 *
 * Convenção: string vazia ou ausente = sem lock (campo editável).
 * Para travar um campo opcional como "sem limite", use "0".
 */

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

export type TokenLocks = {
  requireToken?: boolean;
  durationMin?: number;
  maxUses?: number;
  /** 0 = "sem limite" travado; ausente = livre */
  downKbps?: number;
  upKbps?: number;
  bytesQuotaMB?: number;
  /** Janela relativa em minutos a partir da criação */
  expiresInMin?: number;
};

export function getTokenLocks(): TokenLocks {
  return {
    requireToken: parseBool(process.env.TOKEN_LOCK_REQUIRE),
    durationMin: parsePositiveInt(process.env.TOKEN_LOCK_DURATION_MIN),
    maxUses: parsePositiveInt(process.env.TOKEN_LOCK_MAX_USES),
    downKbps: parsePositiveInt(process.env.TOKEN_LOCK_DOWN_KBPS),
    upKbps: parsePositiveInt(process.env.TOKEN_LOCK_UP_KBPS),
    bytesQuotaMB: parsePositiveInt(process.env.TOKEN_LOCK_BYTES_QUOTA_MB),
    expiresInMin: parsePositiveInt(process.env.TOKEN_LOCK_EXPIRES_IN_MIN),
  };
}

/**
 * Aplica os locks numa entrada de criação de token. Os campos travados
 * sobrescrevem o que o admin enviou. Para campos opcionais com lock = 0,
 * força o valor como `null/undefined` (sem limite).
 */
export function applyLocksToCreateInput<T extends {
  durationMin: number;
  maxUses: number;
  downKbps?: number;
  upKbps?: number;
  bytesQuotaMB?: number;
  expiresAt: Date;
}>(input: T, locks: TokenLocks = getTokenLocks()): T {
  const out = { ...input };
  if (locks.durationMin !== undefined) out.durationMin = locks.durationMin;
  if (locks.maxUses !== undefined) out.maxUses = locks.maxUses;
  if (locks.downKbps !== undefined) out.downKbps = locks.downKbps === 0 ? undefined : locks.downKbps;
  if (locks.upKbps !== undefined) out.upKbps = locks.upKbps === 0 ? undefined : locks.upKbps;
  if (locks.bytesQuotaMB !== undefined) out.bytesQuotaMB = locks.bytesQuotaMB === 0 ? undefined : locks.bytesQuotaMB;
  if (locks.expiresInMin !== undefined) {
    out.expiresAt = new Date(Date.now() + locks.expiresInMin * 60_000);
  }
  return out;
}
