import { describe, expect, it } from "vitest";
import { getGuestRegistrationSchema, isValidBrazilCell, isValidCPF, onlyDigits } from "@/lib/validators";
import { dictionaries } from "@/lib/i18n/dictionaries";

describe("isValidCPF", () => {
  it("aceita CPFs válidos com e sem máscara", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
    expect(isValidCPF("52998224725")).toBe(true);
  });

  it("rejeita dígito verificador errado, sequência repetida e tamanho inválido", () => {
    expect(isValidCPF("529.982.247-24")).toBe(false);
    expect(isValidCPF("111.111.111-11")).toBe(false);
    expect(isValidCPF("1234567890")).toBe(false);
  });
});

describe("isValidBrazilCell", () => {
  it("exige 11 dígitos com nono dígito 9", () => {
    expect(isValidBrazilCell("(11) 91234-5678")).toBe(true);
    expect(isValidBrazilCell("(11) 81234-5678")).toBe(false);
    expect(isValidBrazilCell("(05) 91234-5678")).toBe(false);
    expect(isValidBrazilCell("1191234567")).toBe(false);
  });
});

describe("onlyDigits", () => {
  it("remove tudo que não é dígito", () => {
    expect(onlyDigits("a1-2.3 ")).toBe("123");
  });
});

describe("getGuestRegistrationSchema", () => {
  const valid = {
    fullName: "Maria Silva",
    email: "MARIA@exemplo.com ",
    phone: "(11) 91234-5678",
    cpf: "529.982.247-25",
    acceptTerms: true,
    mac: "AA:BB:CC:DD:EE:FF",
  };

  it("normaliza campos válidos", () => {
    const parsed = getGuestRegistrationSchema(dictionaries.pt.validation).parse(valid);
    expect(parsed.email).toBe("maria@exemplo.com");
    expect(parsed.cpf).toBe("52998224725");
    expect(parsed.phone).toBe("11912345678");
  });

  it("exige aceite dos termos com mensagem traduzida", () => {
    const res = getGuestRegistrationSchema(dictionaries.pt.validation).safeParse({
      ...valid,
      acceptTerms: false,
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].message).toBe(dictionaries.pt.validation.valTermsRequired);
  });

  it("rejeita MAC malformado", () => {
    const res = getGuestRegistrationSchema(dictionaries.pt.validation).safeParse({
      ...valid,
      mac: "zz:bb:cc:dd:ee:ff",
    });
    expect(res.success).toBe(false);
  });

  it("exige token apenas quando requireToken=true", () => {
    const withToken = getGuestRegistrationSchema(dictionaries.pt.validation, { requireToken: true });
    expect(withToken.safeParse(valid).success).toBe(false);
    expect(withToken.safeParse({ ...valid, token: "ABCD-EFGH-JKMN" }).success).toBe(true);
  });
});
