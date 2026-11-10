import { randomUUID } from "node:crypto"
import type { RequestHandler } from "express"
import { logger } from "../logger.js"
import { metrics } from "./metrics.js"

/**
 * Uma linha de log por requisição: id, método, rota, status, duração e usuária.
 * O id vem do nginx (X-Request-Id) quando existe, para cruzar o log do proxy com o da API;
 * senão é gerado aqui. Ele volta na resposta para a usuária poder citá-lo num pedido de ajuda.
 */
export const requestLog: RequestHandler = (req, res, next) => {
  const requestId = readRequestId(req.get("x-request-id")) ?? randomUUID()
  res.locals.requestId = requestId
  res.set("X-Request-Id", requestId)
  const started = process.hrtime.bigint()

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6
    const route = routePattern(req)
    metrics.increment("http_requests_total")
    metrics.increment(`http_status_${Math.floor(res.statusCode / 100)}xx_total`)
    metrics.observe(`http_${req.method} ${route}`, durationMs)
    logger.info(
      {
        requestId,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: (res.locals.user as { id?: string } | undefined)?.id,
      },
      "request",
    )
  })
  next()
}

// Só aceita ids curtos e simples: o cabeçalho é externo e vai para o log.
function readRequestId(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9._-]{8,64}$/.test(value) ? value : undefined
}

/** Padrão da rota (/orders/:id) em vez do caminho real, para agrupar as métricas. */
function routePattern(req: { route?: { path?: string }; baseUrl: string; path: string }): string {
  const pattern = req.route?.path
  return typeof pattern === "string" ? `${req.baseUrl}${pattern}` : req.path
}
