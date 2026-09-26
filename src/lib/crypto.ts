import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/**
 * Cifra simétrica (AES-256-GCM) para segredos guardados no banco — senha e
 * API Key da controladora, por exemplo.
 *
 * Chave: `DATA_ENCRYPTION_KEY` (32 bytes em hex ou base64). Na ausência dela,
 * deriva via HKDF a partir de `ADMIN_SECRET` — nesse caso, trocar o
 * ADMIN_SECRET torna ilegíveis os segredos já gravados (basta salvá-los de novo).
 */

const PREFIX = "enc:v1:";

function loadKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY deve ter 32 bytes (64 hex ou base64)");
    return key;
  }
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Defina DATA_ENCRYPTION_KEY ou ADMIN_SECRET (≥ 32 caracteres) para cifrar segredos");
  }
  return Buffer.from(hkdfSync("sha256", secret, "unifi-captive-portal", "data-encryption-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) throw new Error("Formato de segredo cifrado desconhecido");
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}
