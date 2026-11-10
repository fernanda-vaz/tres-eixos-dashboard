import type { ErrorRequestHandler } from "express"
import { logger } from "../logger.js"
import { metrics } from "./metrics.js"
import { pgErrorCode } from "../pg-errors.js"

/**
 * Códigos de erro estáveis, para o painel decidir pelo `code` e nunca pelo texto da mensagem.
 * A mensagem pode mudar de redação; o código não.
 */
export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "sku_taken"
  | "idempotency_key_reused"
  | "insufficient_stock"
  | "insufficient_material"
  | "rate_limited"
  | "payload_too_large"
  | "invalid_json"
  | "csrf"
  | "concurrency"
  | "internal"

/** Erro esperado, com status HTTP e código. A mensagem é pública; detalhes ajudam o painel a explicar o problema. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly code: ErrorCode = defaultCode(status),
  ) {
    super(message)
    this.name = new.target.name
  }
}

function defaultCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "validation"
    case 401:
      return "unauthorized"
    case 403:
      return "forbidden"
    case 404:
      return "not_found"
    case 409:
      return "conflict"
    case 429:
      return "rate_limited"
    default:
      return "internal"
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, details, "validation")
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Autenticação necessária") {
    super(401, message, undefined, "unauthorized")
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message, undefined, "not_found")
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown, code: ErrorCode = "conflict") {
    super(409, message, details, code)
  }
}

// Disputa entre transações (serialização, deadlock, lock_timeout): o cliente pode tentar de novo.
const CONCURRENCY_CODES = new Set(["40001", "40P01", "55P03"])

type ErrorBody = { error: string; code: ErrorCode; details?: unknown }

function body(code: ErrorCode, error: string, details?: unknown): ErrorBody {
  return { error, code, ...(details !== undefined && { details }) }
}

/** Middleware final: nunca envia stack trace; erros inesperados viram 500 genérico com log interno. */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    if (error.status === 409) metrics.increment("http_conflicts_total")
    return res.status(error.status).json(body(error.code, error.message, error.details))
  }
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined
  if (type === "entity.parse.failed") return res.status(400).json(body("invalid_json", "JSON inválido"))
  if (type === "entity.too.large") {
    return res.status(413).json(body("payload_too_large", "Corpo da requisição grande demais"))
  }
  // Erro do csrf-sync (http-errors com status 403).
  if (typeof error === "object" && error !== null && "code" in error && error.code === "EBADCSRFTOKEN") {
    return res.status(403).json(body("csrf", "Token CSRF ausente ou inválido"))
  }
  const code = pgErrorCode(error)
  if (code && CONCURRENCY_CODES.has(code)) {
    metrics.increment("http_conflicts_total")
    return res.status(409).json(body("concurrency", "Outra operação alterou os mesmos dados. Tente novamente."))
  }
  // Log sanitizado: método, caminho sem query string e o erro; nunca o corpo da requisição.
  metrics.increment("http_internal_errors_total")
  logger.error({ err: error, method: req.method, path: req.path, requestId: res.locals.requestId }, "Erro interno")
  return res.status(500).json(body("internal", "Erro interno"))
}
