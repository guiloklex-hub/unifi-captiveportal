import pino from "pino";

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

export const logger = pino({
  level,
  base: { service: "unifi-portal" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      // PII de guests
      "cpf",
      "email",
      "phone",
      "*.cpf",
      "*.email",
      "*.phone",
      "body.cpf",
      "body.email",
      "body.phone",
      // Segredos e cookies
      "password",
      "UNIFI_PASSWORD",
      "ADMIN_PASSWORD",
      "ADMIN_SECRET",
      "CRON_SECRET",
      "METRICS_TOKEN",
      "cookieHeader",
      "csrfToken",
      "authorization",
      "*.password",
      "*.authorization",
      "*.cookieHeader",
      "*.csrfToken",
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
