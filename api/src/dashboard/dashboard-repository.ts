import type { Queryable } from "../db.js"
import { listLowestAvailable as listLowestStock, type InventoryItem } from "../inventory/inventory-repository.js"
import { listLowestAvailable as listLowestFilament, type Material } from "../inventory/material-repository.js"
import { listOpenOrdersByDeadline, type OrderSummary } from "../orders/order-view-repository.js"
import { ORDER_STATUSES, type OrderStatus } from "../orders/order-rules.js"

// Leitura agregada para a visão geral do painel: uma requisição, poucas consultas, nada de
// "listar tudo e somar no navegador".

export type DashboardSummary = {
  orders: { byStatus: Record<OrderStatus, number>; overdue: number }
  production: { queued: number; printing: number; onHold: number; blocked: number; pieces: number }
  upcomingShipments: OrderSummary[]
  lowStock: InventoryItem[]
  lowFilament: Material[]
}

const TOP = 6

async function orderTotals(db: Queryable): Promise<DashboardSummary["orders"]> {
  const result = await db.query<{ status: OrderStatus; total: number; overdue: number }>(
    `SELECT status, count(*)::int AS total,
            count(*) FILTER (WHERE status NOT IN ('shipped', 'cancelled') AND ship_by < now())::int AS overdue
     FROM orders GROUP BY status`,
  )
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>
  let overdue = 0
  for (const row of result.rows) {
    byStatus[row.status] = row.total
    overdue += row.overdue
  }
  return { byStatus, overdue }
}

async function productionTotals(db: Queryable): Promise<DashboardSummary["production"]> {
  const result = await db.query<{ queued: number; printing: number; on_hold: number; blocked: number; pieces: number }>(
    `SELECT count(*) FILTER (WHERE j.status = 'queued')::int AS queued,
            count(*) FILTER (WHERE j.status = 'printing')::int AS printing,
            count(*) FILTER (WHERE j.status = 'on_hold')::int AS on_hold,
            -- Bloqueado: na fila e com alguma cor da receita sem gramas livres suficientes.
            count(*) FILTER (WHERE j.status = 'queued' AND EXISTS (
              SELECT 1 FROM product_materials pm JOIN materials m ON m.id = pm.material_id
              WHERE pm.product_id = j.product_id AND m.physical_grams - m.reserved_grams < pm.grams_per_unit * j.quantity))::int AS blocked,
            COALESCE(SUM(j.quantity), 0)::int AS pieces
     FROM production_jobs j WHERE j.status IN ('queued', 'printing', 'on_hold')`,
  )
  const row = result.rows[0]
  return { queued: row.queued, printing: row.printing, onHold: row.on_hold, blocked: row.blocked, pieces: row.pieces }
}

export async function loadDashboardSummary(db: Queryable): Promise<DashboardSummary> {
  const [orders, production, upcomingShipments, lowStock, lowFilament] = await Promise.all([
    orderTotals(db),
    productionTotals(db),
    listOpenOrdersByDeadline(db, TOP),
    listLowestStock(db, TOP),
    listLowestFilament(db, TOP),
  ])
  return { orders, production, upcomingShipments, lowStock, lowFilament }
}
