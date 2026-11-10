import type { Queryable } from "./db.js"

/**
 * Steady state: tabelas operacionais não podem crescer para sempre. As de auditoria
 * (stock_movements, material_movements, históricos de status) ficam de fora de propósito.
 */
export const RETENTION_DAYS = {
  /** Chaves de idempotência: o painel reutiliza a chave por segundos, não por dias. */
  idempotencyKeys: 7,
  /** Eventos já publicados: o consumidor já os recebeu; ficam um mês para auditoria. */
  publishedOutbox: 30,
  /** Eventos de integração processados ou ignorados. Falhas ficam até serem resolvidas. */
  processedIntegrationEvents: 90,
  /** Janelas de limite de login (a janela em si é de 15 minutos). */
  loginAttempts: 1,
} as const

export type RetentionResult = Record<keyof typeof RETENTION_DAYS, number>

/** Apaga o que passou do prazo e devolve quantas linhas saíram de cada tabela. */
export async function runRetention(db: Queryable, days: typeof RETENTION_DAYS = RETENTION_DAYS): Promise<RetentionResult> {
  const idempotencyKeys = await db.query(
    "DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(days => $1)",
    [days.idempotencyKeys],
  )
  const publishedOutbox = await db.query(
    "DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < now() - make_interval(days => $1)",
    [days.publishedOutbox],
  )
  const processedIntegrationEvents = await db.query(
    `DELETE FROM integration_events
     WHERE status IN ('processed', 'ignored') AND processed_at < now() - make_interval(days => $1)`,
    [days.processedIntegrationEvents],
  )
  const loginAttempts = await db.query(
    "DELETE FROM login_attempts WHERE window_started_at < now() - make_interval(days => $1)",
    [days.loginAttempts],
  )
  return {
    idempotencyKeys: idempotencyKeys.rowCount ?? 0,
    publishedOutbox: publishedOutbox.rowCount ?? 0,
    processedIntegrationEvents: processedIntegrationEvents.rowCount ?? 0,
    loginAttempts: loginAttempts.rowCount ?? 0,
  }
}
