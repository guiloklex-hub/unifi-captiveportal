import pino from "pino";

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

export const logger = pino({
  level,
  base: { service: "unifi-portal" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "cpf",
      "password",
      "UNIFI_PASSWORD",
      "cookieHeader",
      "csrfToken",
      "*.cpf",
      "*.password",
      "*.cookieHeader",
    ],
    remove: true,
  },
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
