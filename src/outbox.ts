import { randomUUID } from "node:crypto"
import type { Tx } from "./db.js"

export type OutboxTopic =
  | "order.created"
  | "order.status_changed"
  | "order.shipped"
  | "order.cancelled"
  | "production.completed"

/**
 * Grava o evento na MESMA transação da mudança de estado: ou os dois persistem, ou nenhum.
 * A publicação (worker que lê outbox e marca published_at) é uma etapa posterior.
 */
export async function enqueueOutbox(
  tx: Tx,
  topic: OutboxTopic,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.query("INSERT INTO outbox (id, topic, aggregate_id, payload) VALUES ($1, $2, $3, $4)", [
    randomUUID(),
    topic,
    aggregateId,
    JSON.stringify(payload),
  ])
}
