import { randomUUID } from "node:crypto"
import type { Tx } from "../db.js"

export type ActiveReservation = { id: string; productId: string; quantity: number }

export async function insertReservation(
  tx: Tx,
  reservation: { orderItemId: string; productId: string; quantity: number },
): Promise<void> {
  await tx.query(
    `INSERT INTO reservations (id, order_item_id, product_id, quantity, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [randomUUID(), reservation.orderItemId, reservation.productId, reservation.quantity],
  )
}

/** Reservas ativas de um pedido, em ordem de product_id (ordem estável de locks do estoque). */
export async function listActiveReservations(tx: Tx, orderId: string): Promise<ActiveReservation[]> {
  const result = await tx.query<{ id: string; product_id: string; quantity: number }>(
    `SELECT r.id, r.product_id, r.quantity
     FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id
     WHERE oi.order_id = $1 AND r.status = 'active'
     ORDER BY r.product_id`,
    [orderId],
  )
  return result.rows.map((row) => ({ id: row.id, productId: row.product_id, quantity: row.quantity }))
}

export async function setReservationStatus(tx: Tx, id: string, status: "released" | "fulfilled"): Promise<void> {
  await tx.query("UPDATE reservations SET status = $2, updated_at = now() WHERE id = $1", [id, status])
}
