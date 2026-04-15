import { prisma } from "./prisma";

export interface SystemSettings {
  brandName: string;
  logoUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string;
  termsOfUse: string;
}

const DEFAULT_SETTINGS: SystemSettings = {
  brandName: "UniFi Portal",
  logoUrl: null,
  backgroundUrl: null,
  primaryColor: "#171717",
  termsOfUse: "Ao conectar, você aceita os termos de uso e a política de privacidade.",
};

export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    const settings = await prisma.systemSettings.findFirst({
      where: { id: "config" },
    });
    
    if (!settings) {
      // Cria o registro inicial se não existir
      return await prisma.systemSettings.create({
        data: { id: "config", ...DEFAULT_SETTINGS },
      });
    }
    
    return settings as SystemSettings;
  } catch (error) {
    console.error("Error fetching settings:", error);
    return DEFAULT_SETTINGS;
  }
}
