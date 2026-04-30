import { prisma } from "./prisma";

export interface SystemSettings {
  brandName: string;
  logoUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string;
  termsOfUse: string;
  requireToken: boolean;
}

const DEFAULT_SETTINGS: SystemSettings = {
  brandName: "UniFi Portal",
  logoUrl: null,
  backgroundUrl: null,
  primaryColor: "#171717",
  termsOfUse: "Ao conectar, você aceita os termos de uso e a política de privacidade.",
  requireToken: false,
};

export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    const settings = await prisma.systemSettings.upsert({
      where: { id: "config" },
      update: {},
      create: { id: "config", ...DEFAULT_SETTINGS },
    });

    return settings as SystemSettings;
  } catch (error) {
    console.error("Error fetching settings:", error);
    return DEFAULT_SETTINGS;
  }
}
