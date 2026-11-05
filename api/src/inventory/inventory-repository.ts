import { randomUUID } from "node:crypto"
import { pool, queryPage, type Tx } from "../db.js"
import type { PageRequest } from "../pagination.js"
import { likePattern } from "../sql.js"

export type InventoryRow = { productId: string; physical: number; reserved: number }

export type MovementKind = "adjustment" | "reservation" | "release" | "shipment" | "production"

export type NewMovement = {
  productId: string
  kind: MovementKind
  physicalDelta: number
  reservedDelta: number
  reason: string
  operationKey: string
  orderId?: string | null
}

type Row = { product_id: string; physical: number; reserved: number }

const toInventory = (row: Row): InventoryRow => ({
  productId: row.product_id,
  physical: row.physical,
  reserved: row.reserved,
})

/**
 * Registra o movimento de auditoria. Retorna false se a mesma operação (operation_key) já
 * foi registrada: quem chama NÃO deve aplicar o delta de novo.
 */
export async function recordMovement(tx: Tx, movement: NewMovement): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO stock_movements
       (id, product_id, kind, physical_delta, reserved_delta, reason, operation_key, order_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (operation_key) DO NOTHING`,
    [
      randomUUID(),
      movement.productId,
      movement.kind,
      movement.physicalDelta,
      movement.reservedDelta,
      movement.reason,
      movement.operationKey,
      movement.orderId ?? null,
    ],
  )
  return result.rowCount === 1
}

/** Reserva atômica: só altera a linha se houver saldo livre suficiente. null = sem saldo. */
export async function reserveIfAvailable(tx: Tx, productId: string, quantity: number): Promise<InventoryRow | null> {
  const result = await tx.query<Row>(
    `UPDATE inventory
     SET reserved = reserved + $1, updated_at = now()
     WHERE product_id = $2
       AND physical - reserved >= $1
     RETURNING product_id, physical, reserved`,
    [quantity, productId],
  )
  return result.rows[0] ? toInventory(result.rows[0]) : null
}

/** Aplica deltas já validados. As CHECKs do banco são a última barreira contra saldo inválido. */
export async function applyInventoryDelta(
  tx: Tx,
  productId: string,
  physicalDelta: number,
  reservedDelta: number,
): Promise<InventoryRow> {
  const result = await tx.query<Row>(
    `UPDATE inventory
     SET physical = physical + $2, reserved = reserved + $3, updated_at = now()
     WHERE product_id = $1
     RETURNING product_id, physical, reserved`,
    [productId, physicalDelta, reservedDelta],
  )
  if (!result.rows[0]) throw new Error(`Estoque inexistente para o produto ${productId}`)
  return toInventory(result.rows[0])
}

/**
 * Bloqueia as linhas de estoque em ordem estável de product_id. Todos os caminhos que alteram
 * vários produtos usam esta ordem, o que reduz o risco de deadlock entre transações.
 */
export async function lockInventory(tx: Tx, productIds: string[]): Promise<Map<string, InventoryRow>> {
  const ids = [...new Set(productIds)].sort()
  if (!ids.length) return new Map()
  const result = await tx.query<Row>(
    `SELECT product_id, physical, reserved FROM inventory
     WHERE product_id = ANY($1::uuid[])
     ORDER BY product_id
     FOR UPDATE`,
    [ids],
  )
  return new Map(result.rows.map((row) => [row.product_id, toInventory(row)]))
}

export async function findInventory(productId: string): Promise<InventoryRow | null> {
  const result = await pool.query<Row>("SELECT product_id, physical, reserved FROM inventory WHERE product_id = $1", [
    productId,
  ])
  return result.rows[0] ? toInventory(result.rows[0]) : null
}

/** Demanda em espera (itens mapeados sem reserva) e produção em aberto de um produto. */
export async function demandAndSupply(
  tx: Tx,
  productId: string,
): Promise<{ waitingDemand: number; openProduction: number }> {
  const result = await tx.query<{ waiting: string; production: string }>(
    `SELECT
       (SELECT COALESCE(SUM(oi.quantity), 0)
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN reservations r ON r.order_item_id = oi.id
         WHERE oi.product_id = $1 AND r.id IS NULL
           AND o.status IN ('awaiting_stock', 'pending_mapping')) AS waiting,
       (SELECT COALESCE(SUM(quantity), 0)
          FROM production_jobs
         WHERE product_id = $1 AND status IN ('queued', 'printing')) AS production`,
    [productId],
  )
  return { waitingDemand: Number(result.rows[0].waiting), openProduction: Number(result.rows[0].production) }
}

export type InventoryItem = {
  productId: string
  sku: string
  name: string
  active: boolean
  physical: number
  reserved: number
  available: number
  openProduction: number
}

export type InventoryFilter = { search?: string }

export async function listInventory(
  filter: InventoryFilter,
  page: PageRequest,
): Promise<{ items: InventoryItem[]; total: number }> {
  const where = "WHERE ($1::text IS NULL OR p.sku ILIKE $1 OR p.name ILIKE $1)"
  const { rows, total } = await queryPage<{
    product_id: string
    sku: string
    name: string
    active: boolean
    physical: number
    reserved: number
    open_production: string
  }>(
    `SELECT i.product_id, p.sku, p.name, p.active, i.physical, i.reserved,
            (SELECT COALESCE(SUM(j.quantity), 0) FROM production_jobs j
              WHERE j.product_id = i.product_id AND j.status IN ('queued', 'printing')) AS open_production
     FROM inventory i JOIN products p ON p.id = i.product_id
     ${where}
     ORDER BY p.sku
     LIMIT $2 OFFSET $3`,
    `SELECT count(*) AS total FROM inventory i JOIN products p ON p.id = i.product_id ${where}`,
    [filter.search ? likePattern(filter.search) : null],
    page,
  )
  return {
    items: rows.map((row) => ({
      productId: row.product_id,
      sku: row.sku,
      name: row.name,
      active: row.active,
      physical: row.physical,
      reserved: row.reserved,
      available: row.physical - row.reserved,
      openProduction: Number(row.open_production),
    })),
    total,
  }
}

export type Movement = {
  id: string
  productId: string
  sku: string
  kind: MovementKind
  physicalDelta: number
  reservedDelta: number
  reason: string
  orderId: string | null
  createdAt: Date
}

export type MovementFilter = { productId?: string; orderId?: string }

export async function listMovements(
  filter: MovementFilter,
  page: PageRequest,
): Promise<{ items: Movement[]; total: number }> {
  const where = `WHERE ($1::uuid IS NULL OR m.product_id = $1) AND ($2::uuid IS NULL OR m.order_id = $2)`
  const { rows, total } = await queryPage<{
    id: string
    product_id: string
    sku: string
    kind: MovementKind
    physical_delta: number
    reserved_delta: number
    reason: string
    order_id: string | null
    created_at: Date
  }>(
    `SELECT m.id, m.product_id, p.sku, m.kind, m.physical_delta, m.reserved_delta, m.reason, m.order_id, m.created_at
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     ${where}
     ORDER BY m.created_at DESC, m.id
     LIMIT $3 OFFSET $4`,
    `SELECT count(*) AS total FROM stock_movements m ${where}`,
    [filter.productId ?? null, filter.orderId ?? null],
    page,
  )
  return {
    items: rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      sku: row.sku,
      kind: row.kind,
      physicalDelta: row.physical_delta,
      reservedDelta: row.reserved_delta,
      reason: row.reason,
      orderId: row.order_id,
      createdAt: row.created_at,
    })),
    total,
  }
}
