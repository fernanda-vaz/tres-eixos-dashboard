import { randomUUID } from "node:crypto"
import { pool, type Tx } from "../db.js"

// integration_events, import_cursors, external_skus e sales_channels.

/** Registra o evento uma única vez por (canal, event_id). null = evento repetido. */
export async function insertOrderEvent(
  tx: Tx,
  channelId: string,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    `INSERT INTO integration_events (id, channel_id, event_id, event_type, payload, status, attempts)
     VALUES ($1, $2, $3, 'order', $4, 'pending', 1)
     ON CONFLICT (channel_id, event_id) DO NOTHING
     RETURNING id`,
    [randomUUID(), channelId, eventId, JSON.stringify(payload)],
  )
  return result.rows[0]?.id ?? null
}

export async function finishEvent(tx: Tx, id: string, status: "processed" | "ignored"): Promise<void> {
  await tx.query("UPDATE integration_events SET status = $2, processed_at = now() WHERE id = $1", [id, status])
}

// Uma linha de falha por pedido externo: novas falhas só incrementam as tentativas.
const failureEventId = (externalOrderId: string) => `failure:order:${externalOrderId}`

export async function recordOrderFailure(channelId: string, externalOrderId: string, message: string): Promise<void> {
  await pool.query(
    `INSERT INTO integration_events (id, channel_id, event_id, event_type, payload, status, attempts, last_error)
     VALUES ($1, $2, $3, 'order_failure', $4, 'failed', 1, $5)
     ON CONFLICT (channel_id, event_id)
     DO UPDATE SET attempts = integration_events.attempts + 1, last_error = EXCLUDED.last_error, received_at = now()`,
    [randomUUID(), channelId, failureEventId(externalOrderId), JSON.stringify({ externalOrderId }), message],
  )
}

export async function clearOrderFailure(channelId: string, externalOrderId: string): Promise<void> {
  await pool.query(
    "UPDATE integration_events SET status = 'processed', processed_at = now() WHERE channel_id = $1 AND event_id = $2 AND status = 'failed'",
    [channelId, failureEventId(externalOrderId)],
  )
}

export type IntegrationError = { eventId: string; attempts: number; lastError: string | null; receivedAt: Date; payload: unknown }

export async function listFailedEvents(): Promise<IntegrationError[]> {
  const result = await pool.query<{ event_id: string; attempts: number; last_error: string | null; received_at: Date; payload: unknown }>(
    `SELECT event_id, attempts, last_error, received_at, payload FROM integration_events
     WHERE status = 'failed' ORDER BY received_at DESC LIMIT 100`,
  )
  return result.rows.map((row) => ({
    eventId: row.event_id,
    attempts: row.attempts,
    lastError: row.last_error,
    receivedAt: row.received_at,
    payload: row.payload,
  }))
}

export async function findCursor(channelId: string): Promise<string | null> {
  const result = await pool.query<{ cursor: string | null }>("SELECT cursor FROM import_cursors WHERE channel_id = $1", [
    channelId,
  ])
  return result.rows[0]?.cursor ?? null
}

export async function saveCursor(channelId: string, cursor: string): Promise<void> {
  await pool.query(
    `INSERT INTO import_cursors (channel_id, cursor) VALUES ($1, $2)
     ON CONFLICT (channel_id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
    [channelId, cursor],
  )
}

export async function deleteCursor(channelId: string): Promise<void> {
  await pool.query("DELETE FROM import_cursors WHERE channel_id = $1", [channelId])
}

/** Garante uma linha em external_skus para cada SKU (sem produto, se ainda não mapeado). */
export async function registerExternalSkus(tx: Tx, channelId: string, skus: string[]): Promise<void> {
  await tx.query(
    `INSERT INTO external_skus (id, channel_id, external_sku)
     SELECT gen_random_uuid(), $1, sku FROM unnest($2::text[]) AS sku
     ON CONFLICT (channel_id, external_sku) DO NOTHING`,
    [channelId, skus],
  )
}

/** Produto mapeado para cada SKU externo (null = pendente de mapeamento). */
export async function findSkuMappings(tx: Tx, channelId: string, skus: string[]): Promise<Map<string, string | null>> {
  const result = await tx.query<{ external_sku: string; product_id: string | null }>(
    "SELECT external_sku, product_id FROM external_skus WHERE channel_id = $1 AND external_sku = ANY($2::text[])",
    [channelId, skus],
  )
  return new Map(result.rows.map((row) => [row.external_sku, row.product_id]))
}

export async function upsertSkuMapping(tx: Tx, channelId: string, externalSku: string, productId: string): Promise<void> {
  await tx.query(
    `INSERT INTO external_skus (id, channel_id, external_sku, product_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_id, external_sku) DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = now()`,
    [randomUUID(), channelId, externalSku, productId],
  )
}

export type PendingSku = { channelId: string; externalSku: string; pendingOrders: number; firstSeenAt: Date }

export async function listUnmappedSkus(): Promise<PendingSku[]> {
  const result = await pool.query<{ channel_id: string; external_sku: string; pending_orders: string; created_at: Date }>(
    `SELECT e.channel_id, e.external_sku, e.created_at,
            (SELECT count(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE o.channel_id = e.channel_id AND oi.external_sku = e.external_sku AND oi.product_id IS NULL
                AND o.status <> 'cancelled') AS pending_orders
     FROM external_skus e WHERE e.product_id IS NULL ORDER BY e.created_at, e.external_sku`,
  )
  return result.rows.map((row) => ({
    channelId: row.channel_id,
    externalSku: row.external_sku,
    pendingOrders: Number(row.pending_orders),
    firstSeenAt: row.created_at,
  }))
}

export type Channel = { id: string; provider: string; name: string; connectionStatus: string }

export async function listChannels(): Promise<Channel[]> {
  const result = await pool.query<{ id: string; provider: string; name: string; connection_status: string }>(
    "SELECT id, provider, name, connection_status FROM sales_channels ORDER BY created_at, id",
  )
  return result.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    connectionStatus: row.connection_status,
  }))
}
