import type { ErrorRequestHandler } from "express"
import { pgErrorCode } from "../pg-errors.js"

/** Erro esperado, com status HTTP. A mensagem é pública; detalhes ajudam o painel a explicar o problema. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Autenticação necessária") {
    super(401, message)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, message, details)
  }
}

// Disputa entre transações (serialização, deadlock, lock_timeout): o cliente pode tentar de novo.
const CONCURRENCY_CODES = new Set(["40001", "40P01", "55P03"])

/** Middleware final: nunca envia stack trace; erros inesperados viram 500 genérico com log interno. */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.details !== undefined && { details: error.details }),
    })
  }
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined
  if (type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" })
  if (type === "entity.too.large") return res.status(413).json({ error: "Corpo da requisição grande demais" })
  // Erro do csrf-sync (http-errors com status 403).
  if (typeof error === "object" && error !== null && "code" in error && error.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "Token CSRF ausente ou inválido" })
  }
  const code = pgErrorCode(error)
  if (code && CONCURRENCY_CODES.has(code)) {
    return res.status(409).json({ error: "Outra operação alterou os mesmos dados. Tente novamente." })
  }
  // Log sanitizado: método, caminho sem query string e o erro; nunca o corpo da requisição.
  console.error(`Erro interno em ${req.method} ${req.path}`, error)
  return res.status(500).json({ error: "Erro interno" })
}
