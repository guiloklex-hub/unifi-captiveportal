import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    env: {
      ADMIN_SECRET: "test-secret-com-pelo-menos-32-caracteres-aqui",
      LOG_LEVEL: "silent",
    },
  },
});
