import { findProductsBySku } from "../catalog/product-repository.js"
import { pool, withTransaction, type Tx } from "../db.js"
import { ConflictError, NotFoundError, ValidationError } from "../http/errors.js"
import { runIdempotent, type StoredResponse } from "../http/idempotency.js"
import { applyInventoryDelta, lockInventory, recordMovement } from "../inventory/inventory-repository.js"
import { enqueueOutbox } from "../outbox.js"
import { toPage, type Page, type PageRequest } from "../pagination.js"
import { pgConstraint, pgErrorCode } from "../pg-errors.js"
import { holdJob, insertJobHistory, lockOpenJobsForOrder } from "../production/production-repository.js"
import { allocateOrder, allocateWaitingForProduct, releaseReservations } from "./allocation.js"
import { MANUAL_CHANNEL_ID } from "./channels.js"
import type { ManualOrderInput, OrderListFilter } from "./order-input.js"
import { insertOrder, lockOrder, updateStatus, type LockedOrder, type NewOrder, type NewOrderItem } from "./order-repository.js"
import { getOrderView, listOrders, type OrderSummary, type OrderView } from "./order-view-repository.js"
import { listActiveReservations, setReservationStatus } from "./reservation-repository.js"
import { markShipmentDispatched, markShipmentLabelPrinted, markShipmentReady } from "./shipment-repository.js"

const ORDER_NOT_FOUND = "Pedido não encontrado"

/** Cria o pedido, tenta reservar e enfileira produção para faltas. Usado também pela importação. */
export async function createOrderInTransaction(tx: Tx, order: NewOrder): Promise<string> {
  let orderId: string
  try {
    orderId = await insertOrder(tx, order, "awaiting_stock")
  } catch (error) {
    // UNIQUE(channel_id, external_order_id): o mesmo pedido externo nunca vira dois registros.
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "orders_channel_external_unique") {
      throw new ConflictError("Pedido já registrado para este canal", { externalOrderId: order.externalOrderId })
    }
    throw error
  }
  await lockOrder(tx, orderId)
  await allocateOrder(tx, orderId, "Alocação inicial do pedido")
  await enqueueOutbox(tx, "order.created", orderId, { channelId: order.channelId, externalOrderId: order.externalOrderId })
  return orderId
}

/** POST /orders: exige Idempotency-Key. Repetir a mesma requisição devolve o mesmo pedido. */
export function createManualOrder(
  input: ManualOrderInput,
  request: { idempotencyKey: string; body: unknown },
): Promise<StoredResponse & { replayed: boolean }> {
  return withTransaction((tx) =>
    runIdempotent(tx, "orders.create", request.idempotencyKey, request.body, async () => {
      const items = await catalogItems(tx, input.items)
      const orderId = await createOrderInTransaction(tx, {
        channelId: MANUAL_CHANNEL_ID,
        externalOrderId: input.externalOrderId,
        orderedAt: input.orderedAt,
        shipBy: input.shipBy,
        externalStatus: null,
        externalStatusRank: null,
        externalUpdatedAt: null,
        items,
      })
      return { status: 201, body: await getOrderView(tx, orderId) }
    }),
  )
}

/** Resolve os SKUs no catálogo: todos precisam existir e estar ativos. */
async function catalogItems(tx: Tx, items: ManualOrderInput["items"]): Promise<NewOrderItem[]> {
  const products = await findProductsBySku(tx, items.map((item) => item.sku))
  const unknown = items.filter((item) => !products.has(item.sku)).map((item) => item.sku)
  if (unknown.length) throw new ValidationError("SKU não cadastrado", { skus: unknown })
  const inactive = items.filter((item) => !products.get(item.sku)!.active).map((item) => item.sku)
  if (inactive.length) throw new ConflictError("Produto inativo não pode entrar em novo pedido", { skus: inactive })

  return items.map((item) => {
    const product = products.get(item.sku)!
    // Preço congelado: mudanças futuras no catálogo não reescrevem o pedido.
    return { productId: product.id, externalSku: null, quantity: item.quantity, unitPriceCents: product.priceCents }
  })
}

export async function getOrders(filter: OrderListFilter, page: PageRequest): Promise<Page<OrderSummary>> {
  return toPage(page, await listOrders(filter, page))
}

export async function getOrder(orderId: string): Promise<OrderView> {
  const order = await getOrderView(pool, orderId)
  if (!order) throw new NotFoundError(ORDER_NOT_FOUND)
  return order
}

async function lockExisting(tx: Tx, id: string): Promise<LockedOrder> {
  const order = await lockOrder(tx, id)
  if (!order) throw new NotFoundError(ORDER_NOT_FOUND)
  return order
}

async function view(tx: Tx, id: string): Promise<OrderView> {
  return (await getOrderView(tx, id))!
}

/**
 * Cancela antes do envio, na transação recebida: libera reservas uma única vez, coloca em espera
 * a produção ligada ao pedido (exige decisão explícita) e repassa o saldo liberado a quem espera.
 * Cancelar de novo não faz nada.
 */
export async function cancelOrderInTransaction(tx: Tx, order: LockedOrder, reason: string): Promise<void> {
  if (order.status === "cancelled") return
  if (order.status === "shipped") throw new ConflictError("Pedido já enviado não pode ser cancelado")

  await holdOpenJobs(tx, order.id)
  // Ordem de locks: pedido → jobs → estoque (a mesma da conclusão de produção: job → estoque).
  const releasedProducts = await releaseReservations(tx, order.id, `Cancelamento: ${reason}`)
  await updateStatus(tx, order.id, order.status, "cancelled", reason)
  await enqueueOutbox(tx, "order.cancelled", order.id, { reason })
  for (const productId of releasedProducts) {
    await allocateWaitingForProduct(tx, productId)
  }
}

/** A produção do pedido cancelado fica em espera até a loja decidir: concluir para estoque ou cancelar. */
async function holdOpenJobs(tx: Tx, orderId: string): Promise<void> {
  for (const job of await lockOpenJobsForOrder(tx, orderId)) {
    await holdJob(tx, job.id, "Pedido cancelado: decidir se conclui para estoque ou cancela")
    await insertJobHistory(tx, { jobId: job.id, from: job.status, to: "on_hold", reason: "Pedido cancelado" })
  }
}

export function cancelOrder(orderId: string, reason: string): Promise<OrderView> {
  return withTransaction(async (tx) => {
    await cancelOrderInTransaction(tx, await lockExisting(tx, orderId), reason)
    return view(tx, orderId)
  })
}

/** Tenta novamente reservar um pedido em espera (por exemplo, se foi pulado durante uma alocação). */
export function retryAllocation(orderId: string): Promise<OrderView> {
  return withTransaction(async (tx) => {
    const order = await lockExisting(tx, orderId)
    if (order.status === "awaiting_stock" || order.status === "pending_mapping") {
      await allocateOrder(tx, orderId, "Nova tentativa de alocação")
    }
    return view(tx, orderId)
  })
}

/** Separado e embalado. Exige todas as peças reservadas. Não altera o estado externo. */
export function markReady(orderId: string): Promise<OrderView> {
  return withTransaction(async (tx) => {
    const order = await lockExisting(tx, orderId)
    if (order.status === "ready" || order.status === "shipped") return view(tx, orderId)
    if (order.status !== "reserved") {
      throw new ConflictError("Só pedidos com todas as peças reservadas podem ficar prontos", { status: order.status })
    }
    await markShipmentReady(tx, orderId)
    await updateStatus(tx, orderId, order.status, "ready", "Pedido separado e pronto para envio")
    await enqueueOutbox(tx, "order.status_changed", orderId, { from: order.status, to: "ready" })
    return view(tx, orderId)
  })
}

/** Registra a impressão da etiqueta. Não muda o status interno nem o externo. */
export function markLabelPrinted(orderId: string): Promise<OrderView> {
  return withTransaction(async (tx) => {
    const order = await lockExisting(tx, orderId)
    if (order.status !== "ready" && order.status !== "shipped") {
      throw new ConflictError("A etiqueta só pode ser registrada para pedido pronto", { status: order.status })
    }
    await markShipmentLabelPrinted(tx, orderId)
    return view(tx, orderId)
  })
}

/** Expedição: baixa physical e reserved das peças reservadas, uma única vez. */
export function dispatchOrder(orderId: string): Promise<OrderView> {
  return withTransaction(async (tx) => {
    const order = await lockExisting(tx, orderId)
    if (order.status === "shipped") return view(tx, orderId)
    if (order.status !== "ready") {
      throw new ConflictError("Só pedidos prontos podem ser expedidos", { status: order.status })
    }
    await shipReservations(tx, orderId)
    await markShipmentDispatched(tx, orderId)
    await updateStatus(tx, orderId, order.status, "shipped", "Pedido expedido")
    await enqueueOutbox(tx, "order.shipped", orderId, {})
    return view(tx, orderId)
  })
}

/** Baixa do estoque as peças reservadas do pedido. A operation_key impede baixar duas vezes. */
async function shipReservations(tx: Tx, orderId: string): Promise<void> {
  const reservations = await listActiveReservations(tx, orderId)
  await lockInventory(tx, reservations.map((reservation) => reservation.productId))
  for (const reservation of reservations) {
    const recorded = await recordMovement(tx, {
      productId: reservation.productId,
      kind: "shipment",
      physicalDelta: -reservation.quantity,
      reservedDelta: -reservation.quantity,
      reason: "Expedição do pedido",
      operationKey: `ship:${reservation.id}`,
      orderId,
    })
    if (!recorded) continue
    await applyInventoryDelta(tx, reservation.productId, -reservation.quantity, -reservation.quantity)
    await setReservationStatus(tx, reservation.id, "fulfilled")
  }
}
