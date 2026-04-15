import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const path = join(process.cwd(), "public", "uploads", filename);

  if (!existsSync(path)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const file = await readFile(path);
    
    // Tenta inferir o content-type pela extensão
    let contentType = "image/png";
    if (filename.endsWith(".svg")) contentType = "image/svg+xml";
    if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) contentType = "image/jpeg";
    if (filename.endsWith(".webp")) contentType = "image/webp";

    return new NextResponse(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return new NextResponse("Error reading file", { status: 500 });
  }
}
