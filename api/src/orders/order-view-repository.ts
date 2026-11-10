import { queryPage, type Queryable } from "../db.js"
import type { PageRequest } from "../pagination.js"
import type { OrderStatus } from "./order-rules.js"

// Consultas de leitura do pedido (detalhe e listagem), separadas das escritas em order-repository.ts.

export type OrderItemView = {
  id: string
  lineNumber: number
  productId: string | null
  sku: string | null
  externalSku: string | null
  quantity: number
  unitPriceCents: number
  reservation: { id: string; status: string; quantity: number } | null
}

export type OrderView = {
  id: string
  channel: { id: string; provider: string; name: string }
  externalOrderId: string
  status: OrderStatus
  externalStatus: string | null
  orderedAt: Date
  shipBy: Date | null
  createdAt: Date
  cancelledAt: Date | null
  cancelReason: string | null
  totalCents: number
  items: OrderItemView[]
  shipment: { readyAt: Date | null; labelPrintedAt: Date | null; dispatchedAt: Date | null } | null
  productionJobs: { id: string; orderItemId: string | null; status: string; quantity: number }[]
  history: { fromStatus: string | null; toStatus: string; reason: string; createdAt: Date }[]
}

export async function getOrderView(db: Queryable, id: string): Promise<OrderView | null> {
  const order = await db.query<{
    id: string
    channel_id: string
    provider: string
    channel_name: string
    external_order_id: string
    status: OrderStatus
    external_status: string | null
    ordered_at: Date
    ship_by: Date | null
    created_at: Date
    cancelled_at: Date | null
    cancel_reason: string | null
    ready_at: Date | null
    label_printed_at: Date | null
    dispatched_at: Date | null
    has_shipment: boolean
  }>(
    `SELECT o.id, o.channel_id, c.provider, c.name AS channel_name, o.external_order_id, o.status,
            o.external_status, o.ordered_at, o.ship_by, o.created_at, o.cancelled_at, o.cancel_reason,
            s.ready_at, s.label_printed_at, s.dispatched_at, s.order_id IS NOT NULL AS has_shipment
     FROM orders o
     JOIN sales_channels c ON c.id = o.channel_id
     LEFT JOIN shipments s ON s.order_id = o.id
     WHERE o.id = $1`,
    [id],
  )
  const row = order.rows[0]
  if (!row) return null

  // Sequencial de propósito: db pode ser um client em transação, que executa uma consulta por vez.
  const items = await db.query<{
    id: string
    line_number: number
    product_id: string | null
    sku: string | null
    external_sku: string | null
    quantity: number
    unit_price_cents: number
    reservation_id: string | null
    reservation_status: string | null
    reservation_quantity: number | null
  }>(
    `SELECT oi.id, oi.line_number, oi.product_id, p.sku, oi.external_sku, oi.quantity, oi.unit_price_cents,
            r.id AS reservation_id, r.status AS reservation_status, r.quantity AS reservation_quantity
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN reservations r ON r.order_item_id = oi.id
     WHERE oi.order_id = $1
     ORDER BY oi.line_number`,
    [id],
  )
  const jobs = await db.query<{ id: string; order_item_id: string | null; status: string; quantity: number }>(
    `SELECT j.id, j.order_item_id, j.status, j.quantity
     FROM production_jobs j JOIN order_items oi ON oi.id = j.order_item_id
     WHERE oi.order_id = $1 ORDER BY j.created_at, j.id`,
    [id],
  )
  const history = await db.query<{ from_status: string | null; to_status: string; reason: string; created_at: Date }>(
    `SELECT from_status, to_status, reason, created_at FROM order_status_history
     WHERE order_id = $1 ORDER BY created_at, id`,
    [id],
  )

  const itemViews = items.rows.map((item) => ({
    id: item.id,
    lineNumber: item.line_number,
    productId: item.product_id,
    sku: item.sku,
    externalSku: item.external_sku,
    quantity: item.quantity,
    unitPriceCents: item.unit_price_cents,
    reservation: item.reservation_id
      ? { id: item.reservation_id, status: item.reservation_status!, quantity: item.reservation_quantity! }
      : null,
  }))

  return {
    id: row.id,
    channel: { id: row.channel_id, provider: row.provider, name: row.channel_name },
    externalOrderId: row.external_order_id,
    status: row.status,
    externalStatus: row.external_status,
    orderedAt: row.ordered_at,
    shipBy: row.ship_by,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    totalCents: itemViews.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0),
    items: itemViews,
    shipment: row.has_shipment
      ? { readyAt: row.ready_at, labelPrintedAt: row.label_printed_at, dispatchedAt: row.dispatched_at }
      : null,
    productionJobs: jobs.rows.map((job) => ({
      id: job.id,
      orderItemId: job.order_item_id,
      status: job.status,
      quantity: job.quantity,
    })),
    history: history.rows.map((entry) => ({
      fromStatus: entry.from_status,
      toStatus: entry.to_status,
      reason: entry.reason,
      createdAt: entry.created_at,
    })),
  }
}

export type OrderSummary = {
  id: string
  channelProvider: string
  externalOrderId: string
  status: OrderStatus
  externalStatus: string | null
  orderedAt: Date
  shipBy: Date | null
  itemCount: number
  totalCents: number
}

type SummaryRow = {
  id: string
  provider: string
  external_order_id: string
  status: OrderStatus
  external_status: string | null
  ordered_at: Date
  ship_by: Date | null
  item_count: string
  total_cents: string
}

const SUMMARY_SELECT = `
  SELECT o.id, c.provider, o.external_order_id, o.status, o.external_status, o.ordered_at, o.ship_by,
         (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id) AS item_count,
         (SELECT COALESCE(SUM(quantity::bigint * unit_price_cents), 0) FROM order_items WHERE order_id = o.id) AS total_cents
  FROM orders o JOIN sales_channels c ON c.id = o.channel_id`

// Prazo de envio mais próximo primeiro; sem prazo depois; empate pela data do pedido e id.
const SUMMARY_ORDER = "ORDER BY o.ship_by ASC NULLS LAST, o.ordered_at, o.id"

const toSummary = (row: SummaryRow): OrderSummary => ({
  id: row.id,
  channelProvider: row.provider,
  externalOrderId: row.external_order_id,
  status: row.status,
  externalStatus: row.external_status,
  orderedAt: row.ordered_at,
  shipBy: row.ship_by,
  itemCount: Number(row.item_count),
  totalCents: Number(row.total_cents),
})

export async function listOrders(
  db: Queryable,
  filter: { status?: OrderStatus; overdue?: boolean },
  page: PageRequest,
): Promise<{ items: OrderSummary[]; total: number }> {
  // overdue: em aberto (nem enviado nem cancelado) e com prazo de envio já vencido.
  const where = `WHERE ($1::text IS NULL OR o.status = $1)
                   AND (NOT $2::boolean OR (o.status NOT IN ('shipped', 'cancelled') AND o.ship_by < now()))`
  const { rows, total } = await queryPage<SummaryRow>(
    db,
    `${SUMMARY_SELECT} ${where} ${SUMMARY_ORDER} LIMIT $3 OFFSET $4`,
    `SELECT count(*) AS total FROM orders o ${where}`,
    [filter.status ?? null, filter.overdue ?? false],
    page,
  )
  return { items: rows.map(toSummary), total }
}

/** Pedidos em aberto na ordem de atendimento (visão geral: próximos envios). */
export async function listOpenOrdersByDeadline(db: Queryable, limit: number): Promise<OrderSummary[]> {
  const result = await db.query<SummaryRow>(
    `${SUMMARY_SELECT} WHERE o.status NOT IN ('shipped', 'cancelled') ${SUMMARY_ORDER} LIMIT $1`,
    [limit],
  )
  return result.rows.map(toSummary)
}
