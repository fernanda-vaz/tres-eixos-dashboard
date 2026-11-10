import pino from "pino"

/**
 * Log estruturado (uma linha JSON por evento) para API, worker e scripts.
 * LOG_LEVEL controla o nível (padrão info); nos testes fica em silêncio para não poluir a saída.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.SERVICE_NAME ?? "tres-eixos" },
  // Nunca registra corpo de requisição nem credenciais; estes campos ficam fora do log por construção.
  redact: ["req.headers.cookie", "req.headers.authorization"],
})
