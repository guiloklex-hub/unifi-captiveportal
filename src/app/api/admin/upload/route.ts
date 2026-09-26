import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { logger } from "@/lib/logger";
import {
  MAX_UPLOAD_BYTES,
  detectImageType,
  generateUploadName,
  publicUploadUrl,
  uploadDir,
} from "@/lib/uploads";

export const runtime = "nodejs";

// Autenticação: herdada do proxy (src/proxy.ts cobre /api/admin/*).
export async function POST(req: NextRequest) {
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Envio inválido" }, { status: 400 });
  }

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Arquivo maior que ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = detectImageType(buffer);
  if (!kind) {
    return NextResponse.json(
      { error: "Formato não suportado. Use PNG, JPEG, WebP ou GIF." },
      { status: 415 },
    );
  }

  try {
    const dir = uploadDir();
    await mkdir(dir, { recursive: true });
    const fileName = generateUploadName(kind);
    await writeFile(join(dir, fileName), buffer);
    logger.info({ fileName, bytes: buffer.length, mime: kind.mime }, "branding upload saved");
    return NextResponse.json({ success: true, url: publicUploadUrl(fileName) });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "branding upload failed");
    return NextResponse.json({ error: "Falha ao salvar o arquivo" }, { status: 500 });
  }
}
