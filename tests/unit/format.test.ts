import { describe, expect, it } from "vitest";
import { bigIntToNumber, formatBytes, maskCpf } from "@/lib/format";
import { maskCPF, maskPhoneBR } from "@/lib/masks";
import { csvHeaderLine, csvRow, toCSV } from "@/lib/csv";
import { parseUserAgent } from "@/lib/ua-parser";

describe("formatBytes", () => {
  it("formata unidades binárias", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(1024, "en")).toBe("1 KB");
    expect(formatBytes(BigInt(5 * 1024 * 1024), "en")).toBe("5 MB");
  });
});

describe("máscaras", () => {
  it("mascara CPF para exibição", () => {
    expect(maskCpf("52998224725")).toBe("529.***.***-25");
    expect(maskCPF("52998224725")).toBe("529.982.247-25");
  });

  it("mascara telefone progressivamente", () => {
    expect(maskPhoneBR("11")).toBe("(11");
    expect(maskPhoneBR("11912345678")).toBe("(11) 91234-5678");
  });

  it("converte bigint nulo", () => {
    expect(bigIntToNumber(null)).toBe(0);
    expect(bigIntToNumber(BigInt(7))).toBe(7);
  });
});

describe("CSV", () => {
  type Row = { a: string; b: number | null };
  const cols = [
    { key: "a" as const, header: "Coluna A" },
    { key: "b" as const, header: "B" },
  ];

  it("escapa aspas, vírgulas e quebras de linha", () => {
    expect(csvRow<Row>({ a: 'x, "y"', b: null }, cols)).toBe('"x, ""y""",');
    expect(csvHeaderLine(cols)).toBe("Coluna A,B");
    expect(toCSV<Row>([{ a: "1", b: 2 }], cols)).toBe("Coluna A,B\n1,2\n");
  });
});

describe("parseUserAgent", () => {
  it("identifica iPhone Safari", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toEqual({ os: "iOS", browser: "Safari", device: "mobile" });
  });

  it("retorna desconhecido para UA vazio", () => {
    expect(parseUserAgent(null).device).toBe("unknown");
  });
});
