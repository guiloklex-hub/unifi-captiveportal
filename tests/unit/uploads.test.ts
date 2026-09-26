import { describe, expect, it } from "vitest";
import { contentTypeFor, detectImageType, resolveUploadPath, uploadDir } from "@/lib/uploads";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

describe("detectImageType", () => {
  it("detecta formatos permitidos pelos magic bytes", () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47))?.ext).toBe("png");
    expect(detectImageType(bytes(0xff, 0xd8, 0xff))?.ext).toBe("jpg");
    expect(detectImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.ext).toBe("webp");
    expect(detectImageType(new TextEncoder().encode("GIF89a......"))?.ext).toBe("gif");
  });

  it("recusa SVG, HTML e arquivos curtos", () => {
    expect(detectImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(detectImageType(new Uint8Array([0x89]))).toBeNull();
  });
});

describe("resolveUploadPath", () => {
  it("aceita nomes gerados e legados", () => {
    expect(resolveUploadPath("1700000000000-abcdef123456.png")).toBe(`${uploadDir()}/1700000000000-abcdef123456.png`);
    expect(resolveUploadPath("1700000000000_logo_empresa.jpg")).not.toBeNull();
  });

  it("bloqueia path traversal e nomes estranhos", () => {
    expect(resolveUploadPath("../.env")).toBeNull();
    expect(resolveUploadPath("..%2F.env")).toBeNull();
    expect(resolveUploadPath("a/../../etc/passwd")).toBeNull();
    expect(resolveUploadPath(".env")).toBeNull();
    expect(resolveUploadPath("x..png")).toBeNull();
    expect(resolveUploadPath("")).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("mapeia extensões conhecidas", () => {
    expect(contentTypeFor("a.PNG")).toBe("image/png");
    expect(contentTypeFor("a.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("a.exe")).toBe("application/octet-stream");
  });
});
