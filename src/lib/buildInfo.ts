import fs from "node:fs";
import path from "node:path";

export type BuildInfo = {
  sha: string;
  branch: string;
  builtAt: string;
};

let cached: BuildInfo | null = null;

/**
 * Lê o JSON gerado por `scripts/gen-build-info.cjs` durante o `prebuild`.
 * Em dev (sem build) ou se o arquivo não existir, devolve um placeholder.
 * Cache por processo — leitura única no primeiro `getBuildInfo()`.
 */
export function getBuildInfo(): BuildInfo {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "src", "build-info.json"),
      "utf-8",
    );
    const data = JSON.parse(raw) as Partial<BuildInfo>;
    cached = {
      sha: data.sha || "dev",
      branch: data.branch || "dev",
      builtAt: data.builtAt || new Date().toISOString(),
    };
  } catch {
    cached = { sha: "dev", branch: "dev", builtAt: new Date().toISOString() };
  }
  return cached;
}
