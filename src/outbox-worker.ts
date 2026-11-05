import { randomUUID } from "node:crypto"
import { pool } from "./db.js"

/** Tempo máximo de uma publicação (o webhook usa este timeout). */
export const PUBLISH_TIMEOUT_MS = 5_000
export const BATCH_SIZE = 20
// O aluguel cobre o pior caso do lote (todas as publicações esgotando o timeout) com folga:
// assim nenhum evento do lote é realugado por outro worker enquanto este ainda trabalha.
const LEASE_SECONDS = Math.ceil((BATCH_SIZE * PUBLISH_TIMEOUT_MS) / 1000) + 30

export type OutboxEvent = {
  id: string
  topic: string
  aggregateId: string
  payload: unknown
  createdAt: Date
  attempts: number
}

/** Destino dos eventos. Hoje: log estruturado ou webhook; depois, uma fila/broker. */
export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>
}

/** Escreve cada evento como uma linha JSON no stdout (útil para desenvolvimento e auditoria). */
export class LogPublisher implements OutboxPublisher {
  async publish(event: OutboxEvent): Promise<void> {
    console.log(JSON.stringify({ outbox: event.topic, id: event.id, aggregateId: event.aggregateId, payload: event.payload }))
  }
}

/** Envia o evento por POST. O receptor deve deduplicar pelo id: a entrega é "pelo menos uma vez". */
export class WebhookPublisher implements OutboxPublisher {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = PUBLISH_TIMEOUT_MS,
  ) {}

  async publish(event: OutboxEvent): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": event.id },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`Webhook respondeu ${response.status}`)
  }
}

const MAX_BACKOFF_SECONDS = 15 * 60

/** Espera antes da próxima tentativa: 2, 4, 8… segundos, até 15 minutos. */
function retryDelaySeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.max(1, attempts))
}

type OutboxRow = {
  id: string
  seq: string
  topic: string
  aggregate_id: string
  payload: unknown
  created_at: Date
  attempts: number
}

const toEvent = (row: OutboxRow): OutboxEvent => ({
  id: row.id,
  topic: row.topic,
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
       WHERE o.published_at IS NULL AND o.next_attempt_at <= now()
         AND (o.locked_until IS NULL OR o.locked_until < now())
         -- Ordem por pedido: só sai o primeiro evento pendente de cada agregado. Um evento
         -- posterior espera o anterior ser publicado (mesmo que este esteja aguardando retentativa).
         AND NOT EXISTS (
           SELECT 1 FROM outbox earlier
           WHERE earlier.aggregate_id = o.aggregate_id AND earlier.published_at IS NULL
             AND earlier.seq < o.seq
         )
       ORDER BY o.seq
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, seq, topic, aggregate_id, payload, created_at, attempts`,
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

async function scheduleRetry(event: OutboxEvent, error: unknown, leaseId: string): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
  await pool.query(
    `UPDATE outbox SET attempts = attempts + 1, last_error = $2, locked_until = NULL, lease_id = NULL,
            next_attempt_at = now() + make_interval(secs => $3)
     WHERE id = $1 AND lease_id = $4`,
    [event.id, message, retryDelaySeconds(event.attempts + 1), leaseId],
  )
}

/**
 * Aluga até `limit` eventos pendentes (no máximo um por pedido), publica cada um fora de transação
 * e registra o resultado. Uma falha reagenda só aquele evento; os eventos seguintes do mesmo pedido
 * esperam por ele, e os outros pedidos seguem normalmente.
 * Se o worker morrer no meio, o aluguel expira e outro worker republica: o consumidor deduplica
 * pelo id do evento.
 */
export async function publishPendingBatch(publisher: OutboxPublisher, limit = BATCH_SIZE): Promise<{ published: number; failed: number }> {
  const leaseId = randomUUID()
  let published = 0
  let failed = 0
  for (const event of await claimBatch(limit, leaseId)) {
    try {
      await publisher.publish(event)
      await markPublished(event.id, leaseId)
      published += 1
    } catch (error) {
      await scheduleRetry(event, error, leaseId)
      failed += 1
    }
  }
  return { published, failed }
}

/**
 * Laço do worker. `shouldStop` é verificado entre lotes: um lote iniciado sempre termina,
 * então o encerramento respeita o processamento de cada mensagem.
 */
export async function runWorker(
  publisher: OutboxPublisher,
  shouldStop: () => boolean,
  idleMs = 1_000,
): Promise<void> {
  while (!shouldStop()) {
    let result = { published: 0, failed: 0 }
    try {
      result = await publishPendingBatch(publisher)
    } catch (error) {
      console.error("Falha ao ler o outbox", error)
    }
    if (result.published + result.failed === 0 && !shouldStop()) {
      await new Promise((resolve) => setTimeout(resolve, idleMs))
    }
  }
}
