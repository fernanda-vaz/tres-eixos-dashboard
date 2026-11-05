import { randomUUID } from "node:crypto"
import type { Tx } from "../db.js"
import type { ExternalStatus, OrderStatus } from "./order-rules.js"

export type NewOrderItem = {
  productId: string | null
  externalSku: string | null
  quantity: number
  unitPriceCents: number
}

export type NewOrder = {
  channelId: string
  externalOrderId: string
  orderedAt: Date
  shipBy: Date | null
  externalStatus: ExternalStatus | null
  externalStatusRank: number | null
  externalUpdatedAt: Date | null
  items: NewOrderItem[]
}

export async function insertOrder(tx: Tx, order: NewOrder, status: OrderStatus): Promise<string> {
  const id = randomUUID()
  await tx.query(
    `INSERT INTO orders (id, channel_id, external_order_id, status, external_status, external_status_rank,
                         external_updated_at, ordered_at, ship_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      order.channelId,
      order.externalOrderId,
      status,
      order.externalStatus,
      order.externalStatusRank,
      order.externalUpdatedAt,
      order.orderedAt,
      order.shipBy,
    ],
  )
  await tx.query(
    `INSERT INTO order_items (id, order_id, line_number, product_id, external_sku, quantity, unit_price_cents)
     SELECT gen_random_uuid(), $1, line_number, product_id, external_sku, quantity, unit_price_cents
     FROM unnest($2::uuid[], $3::text[], $4::int[], $5::int[]) WITH ORDINALITY
          AS t(product_id, external_sku, quantity, unit_price_cents, line_number)`,
    [
      id,
      order.items.map((item) => item.productId),
      order.items.map((item) => item.externalSku),
      order.items.map((item) => item.quantity),
      order.items.map((item) => item.unitPriceCents),
    ],
  )
  await insertHistory(tx, id, null, status, "Pedido criado")
  return id
}

async function insertHistory(
  tx: Tx,
  orderId: string,
  from: OrderStatus | null,
  to: OrderStatus,
  reason: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), orderId, from, to, reason],
  )
}

export type LockedOrder = {
  id: string
  channelId: string
  status: OrderStatus
  externalStatus: ExternalStatus | null
  externalUpdatedAt: Date | null
}

/** Bloqueia a linha do pedido: confirmação de etapas, cancelamento e alocação não rodam juntos. */
export async function lockOrder(tx: Tx, id: string): Promise<LockedOrder | null> {
  const result = await tx.query<{
    id: string
    channel_id: string
    status: OrderStatus
    external_status: ExternalStatus | null
    external_updated_at: Date | null
  }>(
    "SELECT id, channel_id, status, external_status, external_updated_at FROM orders WHERE id = $1 FOR UPDATE",
    [id],
  )
  const row = result.rows[0]
  return row
    ? {
        id: row.id,
        channelId: row.channel_id,
        status: row.status,
        externalStatus: row.external_status,
        externalUpdatedAt: row.external_updated_at,
      }
    : null
}

export async function findOrderIdByExternal(
  tx: Tx,
  channelId: string,
  externalOrderId: string,
): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    "SELECT id FROM orders WHERE channel_id = $1 AND external_order_id = $2",
    [channelId, externalOrderId],
  )
  return result.rows[0]?.id ?? null
}

export async function updateStatus(
  tx: Tx,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  reason: string,
): Promise<void> {
  await tx.query(
    `UPDATE orders SET status = $2::text, updated_at = now(),
       cancelled_at = CASE WHEN $2::text = 'cancelled' THEN now() ELSE cancelled_at END,
       cancel_reason = CASE WHEN $2::text = 'cancelled' THEN $3::text ELSE cancel_reason END
     WHERE id = $1`,
    [orderId, to, reason],
  )
  await insertHistory(tx, orderId, from, to, reason)
}

export async function getOrderStatus(tx: Tx, orderId: string): Promise<OrderStatus> {
  const result = await tx.query<{ status: OrderStatus }>("SELECT status FROM orders WHERE id = $1", [orderId])
  return result.rows[0].status
}

export async function updateExternalStatus(
  tx: Tx,
  orderId: string,
  external: { status: ExternalStatus; rank: number; updatedAt: Date },
): Promise<void> {
  await tx.query(
    `UPDATE orders SET external_status = $2, external_status_rank = $3, external_updated_at = $4, updated_at = now()
     WHERE id = $1`,
    [orderId, external.status, external.rank, external.updatedAt],
  )
}

/** Estado de alocação de cada item: tem produto (SKU mapeado) e tem reserva ativa. */
export async function listItemAllocationStates(tx: Tx, orderId: string): Promise<{ mapped: boolean; reserved: boolean }[]> {
  const result = await tx.query<{ mapped: boolean; reserved: boolean | null }>(
    `SELECT oi.product_id IS NOT NULL AS mapped, r.status = 'active' AS reserved
     FROM order_items oi LEFT JOIN reservations r ON r.order_item_id = oi.id
     WHERE oi.order_id = $1`,
    [orderId],
  )
  return result.rows.map((row) => ({ mapped: row.mapped, reserved: row.reserved === true }))
}

export type UnreservedItem = { id: string; orderId: string; productId: string; quantity: number }

/** Itens mapeados e ainda sem reserva de um pedido, em ordem de product_id (ordem estável de locks). */
export async function listUnreservedItems(tx: Tx, orderId: string): Promise<UnreservedItem[]> {
  const result = await tx.query<{ id: string; product_id: string; quantity: number }>(
    `SELECT oi.id, oi.product_id, oi.quantity
     FROM order_items oi LEFT JOIN reservations r ON r.order_item_id = oi.id
     WHERE oi.order_id = $1 AND oi.product_id IS NOT NULL AND r.id IS NULL
     ORDER BY oi.product_id, oi.line_number`,
    [orderId],
  )
  return result.rows.map((row) => ({ id: row.id, orderId, productId: row.product_id, quantity: row.quantity }))
}

/**
 * Itens sem reserva de pedidos em espera para um produto, na ordem de atendimento: prazo de envio
 * mais próximo, depois data do pedido. Pedidos bloqueados por outra transação são pulados (SKIP LOCKED).
 */
export async function lockWaitingItemsForProduct(tx: Tx, productId: string): Promise<UnreservedItem[]> {
  const result = await tx.query<{ id: string; order_id: string; quantity: number }>(
    `SELECT oi.id, oi.order_id, oi.quantity
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN reservations r ON r.order_item_id = oi.id
     WHERE oi.product_id = $1 AND r.id IS NULL AND o.status IN ('awaiting_stock', 'pending_mapping')
     ORDER BY o.ship_by ASC NULLS LAST, o.ordered_at, o.id, oi.line_number
     FOR UPDATE OF o SKIP LOCKED`,
    [productId],
  )
  return result.rows.map((row) => ({ id: row.id, orderId: row.order_id, productId, quantity: row.quantity }))
}

/** Pedidos do canal que aguardam o mapeamento deste SKU externo, em ordem de id. */
export async function findOrdersPendingSku(tx: Tx, channelId: string, externalSku: string): Promise<string[]> {
  const result = await tx.query<{ id: string }>(
    `SELECT DISTINCT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.channel_id = $1 AND oi.external_sku = $2 AND oi.product_id IS NULL AND o.status = 'pending_mapping'
     ORDER BY o.id`,
    [channelId, externalSku],
  )
  return result.rows.map((row) => row.id)
}

export async function assignProductToPendingItems(
  tx: Tx,
  orderId: string,
  externalSku: string,
  productId: string,
): Promise<void> {
  await tx.query(
    "UPDATE order_items SET product_id = $3 WHERE order_id = $1 AND external_sku = $2 AND product_id IS NULL",
    [orderId, externalSku, productId],
  )
}

/** Produtos já atribuídos aos itens dos pedidos (para travar o estoque de todos de uma vez). */
export async function findMappedProductIds(tx: Tx, orderIds: string[]): Promise<string[]> {
  if (!orderIds.length) return []
  const result = await tx.query<{ product_id: string }>(
    "SELECT DISTINCT product_id FROM order_items WHERE order_id = ANY($1::uuid[]) AND product_id IS NOT NULL",
    [orderIds],
  )
  return result.rows.map((row) => row.product_id)
}
