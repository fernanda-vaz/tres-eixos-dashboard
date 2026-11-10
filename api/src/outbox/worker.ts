import { randomUUID } from "node:crypto"
import { pool, type Queryable } from "../db.js"
import { logger } from "../logger.js"
import { PUBLISH_TIMEOUT_MS, type OutboxEvent, type OutboxPublisher } from "./publishers.js"
import { MAX_ATTEMPTS, retryDelaySeconds } from "./retry-policy.js"

export { LogPublisher, WebhookPublisher, signWebhook, PUBLISH_TIMEOUT_MS, type OutboxEvent, type OutboxPublisher } from "./publishers.js"
export { MAX_ATTEMPTS, retryDelaySeconds } from "./retry-policy.js"

export const BATCH_SIZE = 20
// O aluguel cobre o pior caso do lote (todas as publicações esgotando o timeout) com folga:
// assim nenhum evento do lote é realugado por outro worker enquanto este ainda trabalha.
const LEASE_SECONDS = Math.ceil((BATCH_SIZE * PUBLISH_TIMEOUT_MS) / 1000) + 30

type OutboxRow = {
  id: string
  seq: string
  topic: string
  aggregate_type: string
  aggregate_id: string
  payload: unknown
  created_at: Date
  attempts: number
}

const toEvent = (row: OutboxRow): OutboxEvent => ({
  id: row.id,
  topic: row.topic,
  aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id,
  payload: row.payload,
  createdAt: row.created_at,
  attempts: row.attempts,
})

/**
 * Aluga até `limit` eventos pendentes por LEASE_SECONDS, marcando o aluguel com `leaseId`.
 * SKIP LOCKED: vários workers não pegam o mesmo evento.
 */
async function claimBatch(limit: number, leaseId: string): Promise<OutboxEvent[]> {
  const claimed = await pool.query<OutboxRow>(
    `UPDATE outbox SET locked_until = now() + make_interval(secs => $2), lease_id = $3
     WHERE id IN (
       SELECT o.id FROM outbox o
       WHERE o.published_at IS NULL AND o.dead_at IS NULL AND o.next_attempt_at <= now()
         AND (o.locked_until IS NULL OR o.locked_until < now())
         -- Ordem por agregado: só sai o primeiro evento pendente de cada agregado. Um evento
         -- posterior espera o anterior ser publicado (mesmo que este esteja aguardando retentativa
         -- ou na dead-letter: a ordem vale mais que a pressa).
         AND NOT EXISTS (
           SELECT 1 FROM outbox earlier
           WHERE earlier.aggregate_id = o.aggregate_id AND earlier.published_at IS NULL
             AND earlier.seq < o.seq
         )
       ORDER BY o.seq
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, seq, topic, aggregate_type, aggregate_id, payload, created_at, attempts`,
    [limit, LEASE_SECONDS, leaseId],
  )
  // Publica na ordem de gravação (RETURNING não garante ordem; seq é bigint, vem como texto).
  return claimed.rows.sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1)).map(toEvent)
}

// As escritas abaixo só valem para quem ainda detém o aluguel (lease_id): um worker com aluguel
// vencido não sobrescreve o resultado de outro.
async function markPublished(id: string, leaseId: string): Promise<void> {
  await pool.query(
    `UPDATE outbox SET published_at = now(), locked_until = NULL, lease_id = NULL, last_error = NULL
     WHERE id = $1 AND lease_id = $2`,
    [id, leaseId],
  )
}

async function scheduleRetry(event: OutboxEvent, error: unknown, leaseId: string): Promise<"retry" | "dead"> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
  const attempts = event.attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE outbox SET attempts = $2, last_error = $3, locked_until = NULL, lease_id = NULL, dead_at = now()
       WHERE id = $1 AND lease_id = $4`,
      [event.id, attempts, message, leaseId],
    )
    logger.error(
      { outbox: event.topic, id: event.id, aggregateId: event.aggregateId, attempts, lastError: message },
      "Evento do outbox esgotou as tentativas e foi para a dead-letter",
    )
    return "dead"
  }
  await pool.query(
    `UPDATE outbox SET attempts = $2, last_error = $3, locked_until = NULL, lease_id = NULL,
            next_attempt_at = now() + make_interval(secs => $4)
     WHERE id = $1 AND lease_id = $5`,
    [event.id, attempts, message, retryDelaySeconds(attempts), leaseId],
  )
  return "retry"
}

export type BatchResult = { published: number; failed: number; dead: number }

/**
 * Aluga até `limit` eventos pendentes (no máximo um por agregado), publica cada um fora de transação
 * e registra o resultado. Uma falha reagenda só aquele evento; os eventos seguintes do mesmo agregado
 * esperam por ele, e os outros agregados seguem normalmente.
 * Se o worker morrer no meio, o aluguel expira e outro worker republica: o consumidor deduplica
 * pelo id do evento.
 */
export async function publishPendingBatch(publisher: OutboxPublisher, limit = BATCH_SIZE): Promise<BatchResult> {
  const leaseId = randomUUID()
  const result: BatchResult = { published: 0, failed: 0, dead: 0 }
  for (const event of await claimBatch(limit, leaseId)) {
    try {
      await publisher.publish(event)
      await markPublished(event.id, leaseId)
      result.published += 1
    } catch (error) {
      const outcome = await scheduleRetry(event, error, leaseId)
      if (outcome === "dead") result.dead += 1
      else result.failed += 1
    }
  }
  return result
}

export type OutboxStats = { pending: number; oldestPendingAgeSeconds: number | null; dead: number }

/** Situação do outbox para métricas e alertas: fila, idade do mais antigo e eventos mortos. */
export async function outboxStats(db: Queryable = pool): Promise<OutboxStats> {
  const result = await db.query<{ pending: number; oldest_age: string | null; dead: number }>(
    `SELECT count(*) FILTER (WHERE published_at IS NULL AND dead_at IS NULL)::int AS pending,
            EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE published_at IS NULL AND dead_at IS NULL)) AS oldest_age,
            count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead
     FROM outbox`,
  )
  const row = result.rows[0]
  return {
    pending: row.pending,
    oldestPendingAgeSeconds: row.oldest_age === null ? null : Math.round(Number(row.oldest_age)),
    dead: row.dead,
  }
}

export type WorkerOptions = {
  idleMs?: number
  /** Chamado a cada volta do laço (para heartbeat) e a cada lote com o resultado. */
  onTick?: (result: BatchResult) => void | Promise<void>
}

/**
 * Laço do worker. `shouldStop` é verificado entre lotes: um lote iniciado sempre termina,
 * então o encerramento respeita o processamento de cada mensagem.
 */
export async function runWorker(publisher: OutboxPublisher, shouldStop: () => boolean, options: WorkerOptions = {}): Promise<void> {
  const idleMs = options.idleMs ?? 1_000
  while (!shouldStop()) {
    let result: BatchResult = { published: 0, failed: 0, dead: 0 }
    try {
      result = await publishPendingBatch(publisher)
    } catch (error) {
      logger.error({ err: error }, "Falha ao ler o outbox")
    }
    try {
      await options.onTick?.(result)
    } catch (error) {
      logger.error({ err: error }, "Falha na tarefa periódica do worker")
    }
    if (result.published + result.failed + result.dead === 0 && !shouldStop()) {
      await new Promise((resolve) => setTimeout(resolve, idleMs))
    }
  }
}
