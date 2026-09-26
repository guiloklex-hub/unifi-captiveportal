import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { contentTypeFor, resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const path = resolveUploadPath(filename);
  if (!path) return new NextResponse("Not Found", { status: 404 });

  let file: Buffer;
  try {
    file = await readFile(path);
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }

  const contentType = contentTypeFor(filename);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // SVGs legados (enviados antes da allowlist) podem conter <script>:
  // servidos em sandbox, sem execução de script nem acesso à origem.
  if (contentType === "image/svg+xml") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  return new NextResponse(new Uint8Array(file), { headers });
}
