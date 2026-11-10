import { randomUUID } from "node:crypto"
import type { Tx } from "../db.js"

export type OutboxTopic =
  | "order.created"
  | "order.status_changed"
  | "order.shipped"
  | "order.cancelled"
  | "production.completed"

export type AggregateType = "order" | "production_job"

/** Cada tópico pertence a um tipo de agregado; o consumidor não precisa inferir pelo nome. */
const AGGREGATE_OF_TOPIC: Record<OutboxTopic, AggregateType> = {
  "order.created": "order",
  "order.status_changed": "order",
  "order.shipped": "order",
  "order.cancelled": "order",
  "production.completed": "production_job",
}

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
  await tx.query("INSERT INTO outbox (id, topic, aggregate_type, aggregate_id, payload) VALUES ($1, $2, $3, $4, $5)", [
    randomUUID(),
    topic,
    AGGREGATE_OF_TOPIC[topic],
    aggregateId,
    JSON.stringify(payload),
  ])
}
