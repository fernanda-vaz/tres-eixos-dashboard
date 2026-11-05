import type { Tx } from "../db.js"

/** Registra a separação (cria o envio, se ainda não existe). Repetir mantém a primeira data. */
export async function markShipmentReady(tx: Tx, orderId: string): Promise<void> {
  await tx.query(
    `INSERT INTO shipments (order_id, ready_at) VALUES ($1, now())
     ON CONFLICT (order_id) DO UPDATE SET ready_at = COALESCE(shipments.ready_at, now()), updated_at = now()`,
    [orderId],
  )
}

export async function markShipmentLabelPrinted(tx: Tx, orderId: string): Promise<void> {
  await tx.query(
    `UPDATE shipments SET label_printed_at = COALESCE(label_printed_at, now()), updated_at = now()
     WHERE order_id = $1`,
    [orderId],
  )
}

export async function markShipmentDispatched(tx: Tx, orderId: string): Promise<void> {
  await tx.query("UPDATE shipments SET dispatched_at = now(), updated_at = now() WHERE order_id = $1", [orderId])
}
