import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { verifySessionToken, ADMIN_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // 1. Verificar Sessão
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  const valid = await verifySessionToken(token);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Gerar nome único para evitar colisões
    const timestamp = Date.now();
    const originalName = file.name.replace(/\s+/g, "_");
    const fileName = `${timestamp}_${originalName}`;
    const path = join(process.cwd(), "public", "uploads", fileName);

    await writeFile(path, buffer);
    
    return NextResponse.json({ 
      success: true, 
      url: `/api/uploads/${fileName}` 
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
