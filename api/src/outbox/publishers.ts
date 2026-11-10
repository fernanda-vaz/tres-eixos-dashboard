import { createHmac } from "node:crypto"
import { logger } from "../logger.js"

/** Tempo máximo de uma publicação (o webhook usa este timeout). */
export const PUBLISH_TIMEOUT_MS = 5_000

export type OutboxEvent = {
  id: string
  topic: string
  aggregateType: string
  aggregateId: string
  payload: unknown
  createdAt: Date
  attempts: number
}

/** Destino dos eventos. Hoje: log estruturado ou webhook; depois, uma fila/broker. */
export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>
}

/** Escreve cada evento como uma linha JSON no log (útil para desenvolvimento e auditoria). */
export class LogPublisher implements OutboxPublisher {
  async publish(event: OutboxEvent): Promise<void> {
    logger.info(
      { outbox: event.topic, id: event.id, aggregateType: event.aggregateType, aggregateId: event.aggregateId, payload: event.payload },
      "outbox event",
    )
  }
}

/**
 * Assinatura HMAC-SHA256 de `timestamp.body`: o receptor recalcula com o mesmo segredo e rejeita
 * corpos alterados ou antigos (o timestamp limita a janela de repetição).
 */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`
}

/**
 * Envia o evento por POST. O receptor deve deduplicar pelo id: a entrega é "pelo menos uma vez".
 * Com `secret`, cada envio leva X-Signature-256 e X-Signature-Timestamp para o receptor confiar na origem.
 */
export class WebhookPublisher implements OutboxPublisher {
  constructor(
    private readonly url: string,
    private readonly secret: string | undefined,
    private readonly timeoutMs = PUBLISH_TIMEOUT_MS,
  ) {}

  async publish(event: OutboxEvent): Promise<void> {
    const body = JSON.stringify(event)
    const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": event.id }
    if (this.secret) {
      const timestamp = String(Math.floor(Date.now() / 1000))
      headers["X-Signature-Timestamp"] = timestamp
      headers["X-Signature-256"] = signWebhook(this.secret, timestamp, body)
    }
    const response = await fetch(this.url, { method: "POST", headers, body, signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw new Error(`Webhook respondeu ${response.status}`)
  }
}
