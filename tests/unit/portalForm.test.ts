import { describe, expect, it } from "vitest";
import { getGuestRegistrationSchema, visitorKeyOf, isValidIntlPhone } from "@/lib/validators";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { maskVisitorKey } from "@/lib/format";

const v = dictionaries.pt.validation;
const ctx = { acceptTerms: true, mac: "aa:bb:cc:dd:ee:ff" };

describe("formulário configurável", () => {
  it("acesso rápido: todos os campos ocultos exigem só o aceite", () => {
    const schema = getGuestRegistrationSchema(v, {
      fieldName: "hidden",
      fieldEmail: "hidden",
      fieldPhone: "hidden",
      fieldDocument: "hidden",
    });
    const out = schema.parse({ ...ctx, fullName: "ignorado", cpf: "123" });
    expect(out).toMatchObject({ fullName: "", email: "", phone: "", cpf: "", document: null, documentType: null });
    expect(schema.safeParse({ ...ctx, acceptTerms: false }).success).toBe(false);
  });

  it("campo opcional aceita vazio mas valida quando preenchido", () => {
    const schema = getGuestRegistrationSchema(v, {
      fieldName: "required",
      fieldEmail: "optional",
      fieldPhone: "hidden",
      fieldDocument: "hidden",
    });
    expect(schema.safeParse({ ...ctx, fullName: "Ana Lima", email: "" }).success).toBe(true);
    const bad = schema.safeParse({ ...ctx, fullName: "Ana Lima", email: "nao-e-email" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({ path: ["email"], message: v.valEmailInvalid });
  });

  it("nome obrigatório precisa de sobrenome", () => {
    const schema = getGuestRegistrationSchema(v, { fieldEmail: "hidden", fieldPhone: "hidden", fieldDocument: "hidden" });
    const res = schema.safeParse({ ...ctx, fullName: "Ana" });
    expect(res.error?.issues[0]).toMatchObject({ path: ["fullName"], message: v.valNameFull });
  });

  it("estrangeiro informa passaporte e telefone internacional", () => {
    const schema = getGuestRegistrationSchema(v, { allowForeignDocument: true });
    const out = schema.parse({
      ...ctx,
      fullName: "John Smith",
      email: "john@example.com",
      phone: "+1 (555) 123-4567",
      documentType: "passport",
      document: "ab-123456",
    });
    expect(out).toMatchObject({ cpf: "", document: "AB123456", documentType: "passport", phone: "+15551234567" });
  });

  it("sem allowForeignDocument, 'passport' é tratado como CPF", () => {
    const schema = getGuestRegistrationSchema(v, {});
    const res = schema.safeParse({
      ...ctx,
      fullName: "John Smith",
      email: "john@example.com",
      phone: "+15551234567",
      documentType: "passport",
      document: "AB123456",
    });
    expect(res.success).toBe(false);
    const paths = res.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["phone", "cpf"]));
  });

  it("documento estrangeiro inválido", () => {
    const schema = getGuestRegistrationSchema(v, { allowForeignDocument: true, fieldEmail: "hidden", fieldPhone: "hidden" });
    const res = schema.safeParse({ ...ctx, fullName: "John Smith", documentType: "passport", document: "x" });
    expect(res.error?.issues[0]).toMatchObject({ path: ["document"], message: v.valDocumentInvalid });
  });
});

describe("isValidIntlPhone", () => {
  it("exige + e 8 a 15 dígitos", () => {
    expect(isValidIntlPhone("+44 20 7946 0958")).toBe(true);
    expect(isValidIntlPhone("5551234567")).toBe(false);
    expect(isValidIntlPhone("+123")).toBe(false);
  });
});

describe("visitorKeyOf / maskVisitorKey", () => {
  it("prioriza CPF, depois documento, e-mail e MAC", () => {
    expect(visitorKeyOf({ cpf: "52998224725", document: "X", email: "a@b.c", mac: "AA" })).toBe("52998224725");
    expect(visitorKeyOf({ cpf: "", document: "AB123", email: "a@b.c", mac: "AA" })).toBe("doc:AB123");
    expect(visitorKeyOf({ cpf: "", document: null, email: "A@B.C", mac: "AA" })).toBe("email:a@b.c");
    expect(visitorKeyOf({ cpf: "", document: null, email: "", mac: "AA:BB" })).toBe("mac:aa:bb");
  });

  it("mascara cada tipo de chave", () => {
    expect(maskVisitorKey("52998224725")).toBe("529.***.***-25");
    expect(maskVisitorKey("doc:AB123456")).toBe("Doc •••••456");
    expect(maskVisitorKey("email:maria@exemplo.com")).toBe("ma•••@exemplo.com");
    expect(maskVisitorKey("mac:aa:bb:cc:dd:ee:ff")).toBe("aa:bb:cc:dd:ee:ff");
  });
});
