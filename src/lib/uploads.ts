import { randomBytes } from "crypto";
import { join, resolve, sep } from "path";

/**
 * Upload de imagens de branding (logo / fundo do portal).
 *
 * Regras de segurança:
 *  - tipo detectado pelos *magic bytes* (não confia em extensão nem em MIME do cliente);
 *  - apenas PNG, JPEG, WebP e GIF — SVG é recusado (pode carregar script → XSS);
 *  - nome gerado no servidor (sem path traversal via `file.name`);
 *  - tamanho máximo configurável.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type ImageKind = { ext: "png" | "jpg" | "webp" | "gif"; mime: string };

export function uploadDir(): string {
  return resolve(process.env.UPLOAD_DIR || join(process.cwd(), "public", "uploads"));
}

export function detectImageType(buf: Uint8Array): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") {
    return { ext: "gif", mime: "image/gif" };
  }
  return null;
}

export function generateUploadName(kind: ImageKind): string {
  return `${Date.now()}-${randomBytes(6).toString("hex")}.${kind.ext}`;
}

// Nomes gerados hoje + nomes legados (`<timestamp>_<original>`), sem barras nem `..`.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * Resolve o caminho absoluto de um arquivo de upload ou `null` quando o nome
 * é inseguro (barras, `..`, caracteres fora da allowlist).
 */
export function resolveUploadPath(filename: string): string | null {
  if (!SAFE_NAME.test(filename) || filename.includes("..")) return null;
  const dir = uploadDir();
  const full = resolve(dir, filename);
  if (!full.startsWith(dir + sep)) return null;
  return full;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** URL pública de uma imagem enviada (servida por /api/uploads/[filename]). */
export function publicUploadUrl(filename: string): string {
  return `/api/uploads/${filename}`;
}
